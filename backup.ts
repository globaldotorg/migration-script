import { config } from "dotenv";
config();

import * as fs from "fs";
import { createObjectCsvStringifier } from "csv-writer";
import { clerkClient, User } from "@clerk/clerk-sdk-node";
import ora from "ora";

const SECRET_KEY = process.env.CLERK_SECRET_KEY;

if (!SECRET_KEY) {
  throw new Error(
    "CLERK_SECRET_KEY is required. Please copy .env.example to .env and add your key."
  );
}

let backedUp = 0;

type CSVRecord = {
  id: string;
  externalId?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  publicMetadata: string;
  canDeleteSelf: boolean;
  canCreateOrg: boolean;
  banned: boolean;
  locked: boolean;
  externalAccounts: string
};

type Header = {
  id: keyof CSVRecord;
  title: string;
};

const HEADERS: Header[] = [
  { id: "id", title: "User ID" },
  { id: "externalId", title: "Database ID" },
  { id: "email", title: "Primary Email Address" },
  { id: "firstName", title: "First Name" },
  { id: "lastName", title: "Last Name" },
  { id: "publicMetadata", title: "Public Metadata" },
  { id: "canDeleteSelf", title: "Delete Account Enabled" },
  { id: "canCreateOrg", title: "Create Org Enabled" },
  { id: "banned", title: "Banned" },
  { id: "locked", title: "Locked" },
  { id: "externalAccounts", title: "External Account Data" }
];

const now = new Date().toISOString().split(".")[0]; // YYYY-MM-DDTHH:mm:ss
function appendCSV(payload: string | null) {
  fs.appendFileSync(
    `./user-backup-${now}.csv`,
    payload || ""
  );
}

async function main() {
  console.log(`Clerk User Backup Utility`);

  const spinner = ora(`Retrieving users`).start();
  let offset = 0;
  const limit = 500;
  const response = await clerkClient.users.getUserList({
    limit,
    orderBy: "+created_at",
  });
  // The API has a limit of 500 users so this will have to be paginated
  let users: User[] = response.data;
  spinner.suffixText = users.length.toLocaleString();
  let total = response.totalCount;
  let hasMoreUsers = total > users.length;
  while (hasMoreUsers) {
    offset = offset + limit;
    const nextBatch = await clerkClient.users.getUserList({
      offset,
      limit,
      orderBy: "+created_at",
    });
    users.push(...nextBatch.data);
    spinner.suffixText = users.length.toLocaleString();
    hasMoreUsers = total > users.length;
  }

  spinner.start(`Exporting CSV`);
  spinner.suffixText = "";

  const records: CSVRecord[] = users.map((u, i) => {
    spinner.suffixText = i.toLocaleString();
    return {
      id: u.id,
      externalId: u.externalId || undefined,
      firstName: u.firstName || undefined,
      lastName: u.lastName || undefined,
      email: u.primaryEmailAddress?.emailAddress || "",
      publicMetadata: JSON.stringify(u.publicMetadata),
      canDeleteSelf: true, // TODO: Not plumbed in either?!
      canCreateOrg: u.createOrganizationEnabled,
      banned: u.banned,
      locked: u.locked,
      externalAccounts: JSON.stringify(u.externalAccounts)
    };
  });

  const csvWriter = createObjectCsvStringifier({
    header: HEADERS,
  });

  appendCSV(csvWriter.getHeaderString())
  records.forEach((r, i) => {
    spinner.suffixText = i.toLocaleString();
    appendCSV(csvWriter.stringifyRecords([r]))
  })

  backedUp = parseInt(spinner.suffixText)
  spinner.suffixText = "";
  spinner.succeed(`Backup complete`);
  return;
}

main().then(() => {
  console.log(`${backedUp} users backed up`);
});
