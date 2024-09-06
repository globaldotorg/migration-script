const teams = require('./team_ids.json')
const orgs = require('./org_ids.json')

for (const team of teams) {
  console.log(team)
}

for (const org of orgs) {
  console.log(org)
}

console.log('total teams:', teams.length)
console.log('total orgs', orgs.length)

const teamNames = new Set(teams.map(team => team.name));
const orgNames = new Set(orgs.map(org => org.name));

const onlyInTeams = new Set([...teamNames].filter(x => !orgNames.has(x)));
const onlyInOrgs = new Set([...orgNames].filter(x => !teamNames.has(x)));

console.log('Names only in teams:', [...onlyInTeams]);
console.log('Names only in orgs:', [...onlyInOrgs]);

for (const team of teams) {
  for (const org of orgs) {
    if (team.name === org.name) {
      const sql = formatSQL(team.id, org.id)
      console.log(sql)
    }
  }
}

function formatSQL(prismaId, clerkId) {
  return `UPDATE public.queries SET org_id = '${clerkId}' WHERE org_id = '${prismaId}';`
}