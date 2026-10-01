# Titans of Proxima

An educational Earth–Luna–Mars colony strategy game: infrastructure, research, cargo, launch windows and fictional settlement decisions. The title is aspirational; this edition's charter takes place on Luna and Mars, not an actual Proxima mission. Gameplay and media are preserved from the existing 1.0.0 source.

[Play on itch.io](https://titans-forge.itch.io/titans-of-proxima) · [Licensing](LICENSING.md) · [Media](MEDIA_RIGHTS.md)

## Run and check

Node.js 22+ and npm:

```sh
npm ci
npm run dev
npm run test:all
npm run build
npm run preview
```

Open the loopback URL printed by Vite. For a static release, serve `dist` over HTTP; do not open it as a file URL. Eight original focused test files run through Node's tsx import hook. The original `npm test` is retained, but `test:all` avoids the tsx CLI IPC dependency. The build type-checks and stages separate rights notices. No cloud/model service is needed to play.

## Play

Complete or skip the charter briefing, inspect Luna's resources, then Resolve Sol. Event decisions, launch windows and research change your options. Maps use 1/2/3; E resolves a sol; F opens fleet, R research, C the desk, G goals, H help, L log and M mute. Music is opt-in. Autosaves and manual slots are browser-local; clearing browser storage removes them. Simulation and authored campaign tests are not independently validated engineering or balance evidence.

The export omits private agent transcripts, cost/approval receipts, local launchers and Git history. [SOURCE_SNAPSHOT.json](SOURCE_SNAPSHOT.json) binds unchanged original runtime/media files. Earlier license grants remain effective; this migration does not create a gameplay upgrade. The hosting-restricted Forge license is source-available, not OSI open source.
