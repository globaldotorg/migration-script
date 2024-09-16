import { config } from "dotenv";
config();

import * as fs from "fs";
import { createObjectCsvStringifier } from "csv-writer";
import {
  clerkClient,
  Organization,
  OrganizationMembership,
  User,
} from "@clerk/clerk-sdk-node";
import ora from "ora";

const SECRET_KEY = process.env.CLERK_SECRET_KEY;

if (!SECRET_KEY) {
  throw new Error(
    "CLERK_SECRET_KEY is required. Please copy .env.example to .env and add your key."
  );
}

let backedUpUsers = 0;
let backedUpOrgs = 0;
let backedUpMemberships = 0;

type UserCSVRecord = {
  id: string;
  externalId?: string;
  firstName?: string;
  lastName?: string;
  createdAt: Date;
  email: string;
  publicMetadata: string;
  canDeleteSelf: boolean;
  canCreateOrg: boolean;
  banned: boolean;
  locked: boolean;
  externalAccounts: string;
};

type OrgCSVRecord = {
  id: string;
  name: string;
  createdAt: Date;
  slug?: string;
  maxAllowedMembers: number;
  creatorId: string;
};

type OrgMembershipCSVRecord = {
  orgId: string;
  orgName: string;
  userId: string;
  userEmail: string; // Technically the "user identifier," which is not the ID, but is usually email
};

type UserCSVHeader = {
  id: keyof UserCSVRecord;
  title: string;
};

type OrgCSVHeader = {
  id: keyof OrgCSVRecord;
  title: string;
};

type OrgMembershipCSVHeader = {
  id: keyof OrgMembershipCSVRecord;
  title: string;
};

const USER_HEADERS: UserCSVHeader[] = [
  { id: "id", title: "User ID" },
  { id: "externalId", title: "Database ID" },
  { id: "email", title: "Primary Email Address" },
  { id: "firstName", title: "First Name" },
  { id: "lastName", title: "Last Name" },
  { id: "createdAt", title: "Created" },
  { id: "publicMetadata", title: "Public Metadata" },
  { id: "canDeleteSelf", title: "Delete Account Enabled" },
  { id: "canCreateOrg", title: "Create Org Enabled" },
  { id: "banned", title: "Banned" },
  { id: "locked", title: "Locked" },
  { id: "externalAccounts", title: "External Account Data" },
];

const ORG_HEADERS: OrgCSVHeader[] = [
  { id: "id", title: "Org ID" },
  { id: "name", title: "Name" },
  { id: "slug", title: "Slug" },
  { id: "createdAt", title: "Created At" },
  { id: "maxAllowedMembers", title: "Member Limit" },
  { id: "creatorId", title: "Creator User ID" },
];

const ORG_MEMBERSHIP_HEADERS: OrgMembershipCSVHeader[] = [
  { id: "orgId", title: "Org ID" },
  { id: "userId", title: "User ID" },
  { id: "orgName", title: "Org Name"},
  { id: "userEmail", title: "User Email (usually)"}
];

const now = new Date().toISOString().split(".")[0]; // YYYY-MM-DDTHH:mm:ss
function appendUserCsv(payload: string | null) {
  fs.appendFileSync(`./user-backup-${now}.csv`, payload || "");
}

function appendOrgCsv(payload: string | null) {
  fs.appendFileSync(`./org-backup-${now}.csv`, payload || "");
}

function appendOrgMembershipCsv(payload: string | null) {
  fs.appendFileSync(`./org-member-backup-${now}.csv`, payload || "");
}

async function main() {
  console.log(`Clerk Backup Utility`);

  const spinner = ora(`Retrieving users`).start();
  let offset = 0;
  const limit = 500;
  const userParams: any = {
    limit,
    orderBy: "-created_at",
  }
  const userResponse = await clerkClient.users.getUserList({
    ...userParams
  });
  // The API has a limit of 500 users so this will have to be paginated
  let users: User[] = userResponse.data;
  spinner.suffixText = users.length.toLocaleString();
  let totalUsers = userResponse.totalCount;
  let hasMoreUsers = totalUsers > users.length;
  while (hasMoreUsers) {
    offset = offset + limit;
    const nextBatch = await clerkClient.users.getUserList({
      offset,
      ...userParams
    });
    users.push(...nextBatch.data);
    spinner.suffixText = users.length.toLocaleString();
    hasMoreUsers = totalUsers > users.length;
  }

  spinner.start(`Exporting User CSV`);
  spinner.suffixText = "";

  const userRecords: UserCSVRecord[] = users.map((u, i) => {
    spinner.suffixText = i.toLocaleString();
    return {
      id: u.id,
      externalId: u.externalId || undefined,
      firstName: u.firstName || undefined,
      lastName: u.lastName || undefined,
      createdAt: new Date(u.createdAt),
      email: u.primaryEmailAddress?.emailAddress || "",
      publicMetadata: JSON.stringify(u.publicMetadata),
      canDeleteSelf: u.deleteSelfEnabled,
      canCreateOrg: u.createOrganizationEnabled,
      banned: u.banned,
      locked: u.locked,
      externalAccounts: JSON.stringify(u.externalAccounts),
    };
  });

  const userCsvWriter = createObjectCsvStringifier({
    header: USER_HEADERS,
  });
  appendUserCsv(userCsvWriter.getHeaderString());
  userRecords.forEach((r, i) => {
    spinner.suffixText = i.toLocaleString();
    appendUserCsv(userCsvWriter.stringifyRecords([r]));
    backedUpUsers++;
  });

  spinner.start(`Retrieving Orgs`);
  spinner.suffixText = "";
  offset = 0;
  const orgParams: any = {
    limit,
    orderBy: "+created_at"
  }
  const orgResponse = await clerkClient.organizations.getOrganizationList({
    ...orgParams
  });
  // The API has a limit of 500 orgs so this will have to be paginated
  let orgs: Organization[] = orgResponse.data;
  spinner.suffixText = orgs.length.toLocaleString();
  let totalOrgs = orgResponse.totalCount;
  let hasMoreOrgs = totalOrgs > orgs.length;
  while (hasMoreOrgs) {
    offset = offset + limit;
    const nextBatch = await clerkClient.organizations.getOrganizationList({
      offset,
      ...orgParams
    });
    orgs.push(...nextBatch.data);
    spinner.suffixText = orgs.length.toLocaleString();
    hasMoreOrgs = totalUsers > orgs.length;
  }

  spinner.start(`Exporting Org CSV`);
  spinner.suffixText = "";

  const orgRecords: OrgCSVRecord[] = orgs.map((o, i) => {
    spinner.suffixText = i.toLocaleString();
    return {
      id: o.id,
      name: o.name,
      slug: o.slug || undefined,
      createdAt: new Date(o.createdAt),
      maxAllowedMembers: o.maxAllowedMemberships,
      creatorId: o.createdBy,
    };
  });

  const orgCsvWriter = createObjectCsvStringifier({
    header: ORG_HEADERS,
  });
  appendOrgCsv(orgCsvWriter.getHeaderString());
  orgRecords.forEach((r, i) => {
    spinner.suffixText = i.toLocaleString();
    appendOrgCsv(orgCsvWriter.stringifyRecords([r]));
    backedUpOrgs++;
  });

  spinner.start(`Retrieving Org Memberships`);
  spinner.suffixText = "";
  let orgMemberRecords: OrgMembershipCSVRecord[] = [];

  for await (const o of orgs) {
    spinner.suffixText = `[org: ${o.name}]`
    // The API has a limit of 500 memberships so this will have to be paginated
    let orgMemberships: OrganizationMembership[] = [];
    let offset = 0;
    const limit = 500;
    let hasMoreMemberships = false;
    do {
      const membersResponse =
        await clerkClient.organizations.getOrganizationMembershipList({
          limit,
          offset,
          organizationId: o.id,
        });
        orgMemberships.push(...membersResponse.data);
      let orgTotalMembers = membersResponse.totalCount;
      hasMoreMemberships = orgTotalMembers > orgMemberships.length;
      offset = offset + limit;
    } while (hasMoreMemberships);

    orgMemberRecords.push(
      ...orgMemberships
        // For type-safety, filter out any memberships lacking user data
        .filter((m) => !!m.publicUserData && !!m.publicUserData.userId)
        .map((m) => {
          return {
            orgId: m.organization.id,
            orgName: m.organization.name,
            userId: m.publicUserData?.userId || "",
            userEmail: m.publicUserData?.identifier || ""
          };
        })
    );
  }

  spinner.start(`Exporting Org Membership CSV`);
  spinner.suffixText = "";

  const orgMembershipCsvWriter = createObjectCsvStringifier({
    header: ORG_MEMBERSHIP_HEADERS,
  });
  appendOrgMembershipCsv(orgMembershipCsvWriter.getHeaderString());
  orgMemberRecords.forEach((r, i) => {
    appendOrgMembershipCsv(orgMembershipCsvWriter.stringifyRecords([r]));
    backedUpMemberships++;
  });

  spinner.succeed(`Backup complete`);
  return;
}

main().then(() => {
  console.log(`${backedUpUsers} users backed up`);
  console.log(`${backedUpOrgs} organizations backed up`);
  console.log(`${backedUpMemberships} organization memberships backed up`);
});
