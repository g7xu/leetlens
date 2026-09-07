# The LeetLens GitHub App

Reference for the maintainer. Users never see this: they click **Sign in with
GitHub**, type a code, and are done.

## Why an app rather than a personal access token

A fine-grained token needs three permissions set by hand, and GitHub reports
the missing one (Workflows) as a **404**, which reads as "repo not found". That
single confusion is the most common reason setup is abandoned. An app declares
its permissions once, and the OAuth **device flow** needs only a client id — no
client secret, so nothing secret ships inside the extension.

## Registering it

At <https://github.com/settings/apps/new>:

| Setting | Value |
|---|---|
| GitHub App name | `LeetLens` |
| Homepage URL | the repository URL |
| Callback URL | *leave empty* |
| **Enable Device Flow** | **checked** — without it the sign-in cannot work |
| Webhook | **uncheck** Active |
| Where can this be installed | **Any account** |

Repository permissions:

| Permission | Access | Needed for |
|---|---|---|
| Contents | Read and write | Committing sessions and solutions |
| Workflows | Read and write | Writing `.github/workflows/publish.yml` during setup |
| Pages | Read and write | Turning the dashboard on without a manual step |
| Metadata | Read-only | Added automatically |

No account permissions. Generate **no** client secret: device flow does not use
one, and refreshing a device-flow token does not either.

Leave user-token expiration enabled (the default). Tokens then last 8 hours and
come with a refresh token valid for 6 months, which the extension uses
automatically; `auth.js` also handles non-expiring tokens if that is ever
turned off.

## Wiring it up

Copy the **Client ID** from the app's settings page into `CLIENT_ID` in
`extension/src/lib/auth.js`. It is not a secret — it appears in every device
flow request — so it belongs in the source, not in configuration.

While `CLIENT_ID` is empty the extension hides the sign-in button and offers
only the token path, so an unreleased build is still usable.

## What users must still do once

A user access token reaches only repositories where the app is **installed**.
After signing in, the user installs LeetLens on their data repo; the options
page links straight to the install page, and Test connection explains a 404 as
"install the app on this repo".
