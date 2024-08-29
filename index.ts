import { config } from "dotenv";
config();

import * as fs from "fs";
import * as z from "zod";
import { clerkClient } from "@clerk/clerk-sdk-node";
import ora, { Ora } from "ora";

const SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DELAY = parseInt(process.env.DELAY_MS ?? `1_000`);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY_MS ?? `10_000`);
const IMPORT_TO_DEV = process.env.IMPORT_TO_DEV_INSTANCE ?? "false";
const OFFSET = parseInt(process.env.OFFSET ?? `0`);

if (!SECRET_KEY) {
  throw new Error(
    "CLERK_SECRET_KEY is required. Please copy .env.example to .env and add your key."
  );
}

if (SECRET_KEY.split("_")[1] !== "live" && IMPORT_TO_DEV === "false") {
  throw new Error(
    "The Clerk Secret Key provided is for a development instance. Development instances are limited to 500 users and do not share their userbase with production instances. If you want to import users to your development instance, please set 'IMPORT_TO_DEV_INSTANCE' in your .env to 'true'."
  );
}

const userSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  location: z.string().optional(),
  agreedTerms: z.boolean(),
});

type User = z.infer<typeof userSchema>;

const splitName = (
  name: string | undefined
): [string | undefined, string | undefined] => {
  let firstName: string | undefined = undefined;
  let lastName: string | undefined = undefined;

  if (name === '"') {
    return [undefined, undefined];
  }
  const trimmed = name?.trim();
  const nameParts = trimmed?.split(" ") || [];
  if (nameParts.length === 2) {
    // If there's just two words, assume it's "first last"
    firstName = nameParts[0];
    lastName = nameParts[1];
  } else {
    // Punt! Put it in the `firstName` and let them fix it in the app.
    firstName = trimmed;
  }

  return [firstName, lastName];
};

const createUser = (userData: User) => {
  const [firstName, lastName] = splitName(userData.name);
  let org = userData.location
  if (org === '"') {
    org = undefined
  }

  return clerkClient.users.createUser({
    externalId: userData.userId,
    emailAddress: [userData.email],
    firstName,
    lastName,
    skipPasswordRequirement: true,
    publicMetadata: {
      // Migrate whether they agreed to TOC already
      agreedTerms: userData.agreedTerms,
      // We don't currently store the email consent in the DB, default to false
      emailConsent: false,
      // "location" goes here
      org,
    },
  });
};

const updateUser = async (userData: User) => {
  const response = await clerkClient.users.getUserList({
    emailAddress: [userData.email],
  });

  if (response && response.data.length > 0) {
    const existing = response.data[0];
    const [firstName, lastName] = splitName(userData.name);
    let org = userData.location
    if (org === '"') {
      org = undefined
    }
    if (
      existing.externalId !== userData.userId ||
      existing.firstName !== firstName ||
      existing.lastName !== lastName ||
      existing.publicMetadata.agreedTerms !== userData.agreedTerms ||
      existing.publicMetadata.org !== org ||
      existing.createOrganizationEnabled
    ) {
      return clerkClient.users.updateUser(response.data[0].id, {
        externalId: userData.userId,
        firstName,
        lastName,
        publicMetadata: {
          agreedTerms: userData.agreedTerms,
          emailConsent: false,
          org
        },
        // TODO: sync these with the new user settings using API?
        createOrganizationEnabled: false,
        deleteSelfEnabled: false
      });
    }
  }
};

const now = new Date().toISOString().split(".")[0]; // YYYY-MM-DDTHH:mm:ss
function appendLog(payload: any) {
  fs.appendFileSync(
    `./migration-log-${now}.json`,
    `\n${JSON.stringify(payload, null, 2)}`
  );
}

let migrated = 0;
let updated = 0;

async function processUserToClerk(userData: User, spinner: Ora) {
  const txt = spinner.text;
  try {
    const parsedUserData = userSchema.safeParse(userData);
    if (!parsedUserData.success) {
      throw parsedUserData.error;
    }
    await createUser(parsedUserData.data);

    migrated++;
  } catch (error) {
    if (error.status === 422) {
      const parsedUserData = userSchema.safeParse(userData);
      if (parsedUserData.success) {
        const up = await updateUser(parsedUserData.data)
        if (up) {
          updated++;
        }
      }
      return;
    }

    // Keep cooldown in case rate limit is reached as a fallback if the thread blocking fails
    if (error.status === 429) {
      spinner.text = `${txt} - rate limit reached, waiting for ${RETRY_DELAY} ms`;
      await rateLimitCooldown();
      spinner.text = txt;
      return processUserToClerk(userData, spinner);
    }

    appendLog({ userId: userData.userId, ...error });
  }
}

async function cooldown() {
  await new Promise((r) => setTimeout(r, DELAY));
}

async function rateLimitCooldown() {
  await new Promise((r) => setTimeout(r, RETRY_DELAY));
}

async function main() {
  console.log(`Clerk User Migration Utility`);

  const inputFileName = process.argv[2] ?? "users.json";

  console.log(`Fetching users from ${inputFileName}`);

  const parsedUserData: any[] = JSON.parse(
    fs.readFileSync(inputFileName, "utf-8")
  );
  const offsetUsers = parsedUserData.slice(OFFSET);
  console.log(
    `users.json found and parsed, attempting migration with an offset of ${OFFSET}`
  );

  let i = 0;
  const spinner = ora(`Migrating users`).start();

  for (const userData of offsetUsers) {
    spinner.text = `Migrating user ${i}/${offsetUsers.length}, cooldown`;
    await cooldown();
    i++;
    spinner.text = `Migrating user ${i}/${offsetUsers.length}`;
    await processUserToClerk(userData, spinner);
  }

  spinner.succeed(`Migration complete`);
  return;
}

main().then(() => {
  console.log(`${migrated} users migrated`);
  console.log(`${updated} users updated`);
});
