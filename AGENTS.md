# Plugin release versions

For each new plugin code release, increment the patch version before building the deliverable. Keep `manifest.json`, `package.json`, and the root/package versions in `package-lock.json` synchronized. Do not publish changed plugin code under an unchanged version.

The side panel must show the version of the extension actually loaded by Chrome, so users can verify whether they have reloaded the new build.
