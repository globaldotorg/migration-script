import { config } from "dotenv";
config();

import { clerkClient } from "@clerk/clerk-sdk-node";

const SECRET_KEY = process.env.CLERK_SECRET_KEY;
const IMPORT_TO_DEV = process.env.IMPORT_TO_DEV_INSTANCE ?? "false";

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

async function main() {
  const orgs = await clerkClient.organizations.getOrganizationList({ limit: 500 })
  console.log(JSON.stringify(orgs.data.map(org => ({ id:org.id, name: org.name}))))
}

await main()
