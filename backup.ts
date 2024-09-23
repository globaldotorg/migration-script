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
  domainsJson: string;
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
  { id: "domainsJson", title: "Domains" },
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

// TODO: Replace this and getOrgDomains with a call to the Clerk Backend Client,
// once they've updated it with the Org Domains endpoints
function clerkOrgDomainUrl(orgId: string): string {
  return `https://api.clerk.com/v1/organizations/${orgId}/domains`
}

async function getOrgDomains(orgId: string): Promise<{ domain: string, verified: boolean, mode: string }[]> {
  const clerkRsp = await fetch(clerkOrgDomainUrl(orgId), {
    headers: { Authorization: `Bearer ${SECRET_KEY}` }
  })
  const clerkObj = await clerkRsp.json()
  const domains: { domain: string, verified: boolean, mode: string }[] = []
  clerkObj.data.forEach((d: any) => {
    domains.push({ domain: d.name, verified: d.verification?.status === "verified", mode: d.enrollment_mode })
  })
  return domains
}

async function main() {
  console.log(`Clerk Backup Utility`);

  const spinner = ora(`Retrieving users`).start();
  let offset = 0;
  let limit = 500;
  
  // The API has a limit of 500 users so this will have to be paginated
  let users: User[] = []
  spinner.suffixText = users.length.toLocaleString();
  let hasMoreUsers = false
  do {
    const userResponse = await clerkClient.users.getUserList({
      offset,
      limit,
      orderBy: "-created_at",
    });
    users.push(...userResponse.data);
    spinner.suffixText = users.length.toLocaleString();
    hasMoreUsers = userResponse.totalCount > users.length;
    offset = offset + limit;
  } while (hasMoreUsers)

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
  // The API has a limit of 500 orgs so this will have to be paginated
  let orgs: Organization[] = []
  let hasMoreOrgs = false;
  do {
    const orgResponse = await clerkClient.organizations.getOrganizationList({
      offset,
      limit,
      orderBy: "+created_at"
    });
    orgs.push(...orgResponse.data);
    spinner.suffixText = orgs.length.toLocaleString();
    hasMoreOrgs = orgResponse.totalCount > orgs.length;
    offset = offset + limit;
  } while (hasMoreOrgs)

  spinner.start(`Exporting Org CSV`);
  spinner.suffixText = "";

  const orgRecords = await Promise.all(orgs.map(async (o, i) => {
    spinner.suffixText = i.toLocaleString();

    // For each org, we need to make another request to get its domains
    const domains = await getOrgDomains(o.id)

    return {
      id: o.id,
      name: o.name,
      slug: o.slug || undefined,
      createdAt: new Date(o.createdAt),
      maxAllowedMembers: o.maxAllowedMemberships,
      creatorId: o.createdBy,
      domainsJson: JSON.stringify(domains)
    };
  }));

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
