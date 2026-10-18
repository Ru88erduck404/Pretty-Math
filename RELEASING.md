# Releasing

Day to day this is one command. The setup below is done once.

## Releasing a version

```
git push origin main --follow-tags
```

after bumping `"version"` in `package.json`, writing the changelog entry, and
tagging:

```
git tag -a v0.1.7 -m "Pretty Math 0.1.7"
```

The workflow runs the six test suites, refuses the release if the tag and
`package.json` disagree, builds the `.vsix`, attaches it to a GitHub release,
and publishes it to the Marketplace. Installed copies update themselves from
there within a day.

## One-time setup

Publishing used to need a personal access token with the "all accessible
organizations" scope. Those are retired on **1 December 2026**. The workflow
now authenticates with Microsoft Entra ID over GitHub's OIDC instead: GitHub
proves its identity to Microsoft during the run, so there is no token stored
anywhere and nothing to rotate.

Three things have to agree: an identity in Entra, a rule saying this
repository may use it, and a grant saying that identity may publish.

### 1. An identity

In the [Azure portal](https://portal.azure.com), create a **user-assigned
managed identity** (search "Managed Identities" > Create). Any name, any
region, any resource group. Nothing runs on it; it exists to be authenticated
as.

From its Overview, note the **Client ID** and the **Directory (tenant) ID**.

### 2. A rule saying this repository may use it

On that identity, go to **Settings > Federated credentials > Add credential**:

- Scenario: **GitHub Actions deploying Azure resources**
- Organization: `Ru88erduck404`
- Repository: `Pretty-Math`
- Entity: **Environment**
- Environment: `release`

The environment is what keeps this narrow: only a run in that environment of
that repository can authenticate as the identity. Create it on the GitHub side
under **Settings > Environments > New environment**, named `release`.

Then add the two ids under **Settings > Secrets and variables > Actions >
Variables** (not Secrets — neither is one):

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | the identity's client id |
| `AZURE_TENANT_ID` | the directory id |

### 3. A grant saying that identity may publish

Signing in only proves GitHub can authenticate as the identity. Permission to
publish is separate, and is granted on the publisher.

The publisher identifies the identity by its Marketplace profile id, which is
neither of the ids above. To find it, run the workflow once with **dry run**
ticked (Actions > Publish > Run workflow). It signs in, prints the id, and
publishes nothing.

Then open the [publisher's
members](https://marketplace.visualstudio.com/manage/publishers/ru88erduck404),
add that id, and give it **Contributor**.

### Checking it

Run the workflow with **dry run** ticked. `verify-pat` reports whether the
identity may publish, without publishing. When that passes, a tag push is all
it takes.

## Publishing by hand

Nothing above is required to ship a release. Building the `.vsix` locally and
uploading it at
[marketplace.visualstudio.com/manage/publishers/ru88erduck404](https://marketplace.visualstudio.com/manage/publishers/ru88erduck404)
(the **…** menu > Update) does the same job and needs no tokens at all.
