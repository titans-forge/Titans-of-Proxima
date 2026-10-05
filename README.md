# Titans of Proxima

The Moon is only the beginning. Build a lunar outpost, establish a colony on
Mars, and keep the people and supply lines on both worlds alive.

[Play free on itch.io](https://titans-forge.itch.io/titans-of-proxima) |
[Releases](https://github.com/titans-forge/Titans-of-Proxima/releases) |
[Licensing](LICENSING.md) | [Media credits](MEDIA_RIGHTS.md)

## Version 1.1.0

- Shared route planning and clearer departure, arrival, and cargo decisions.
- Dock repairs with itemized costs, plus crew hiring and transfers.
- Improved recovery feedback and longer public-action campaign regression checks.
- New planet/ship illustrations and continuous lunar and Martian terrain.
- A compact Mars-specific Aresfab foundry with terrain contact and readable labels.
- Screen-space building labels that avoid collisions and interface overlays;
  warning markers remain visible when labels cannot fit.
- Forge Game Hosting License 1.1 explicitly exempts genuine educational hosting.

This is a fictional, AI-assisted colony strategy game, not validated engineering
or a prediction of real space settlement. The name is aspirational: the current
campaign takes place on Earth, Luna, and Mars, not an actual Proxima mission.

## Play

Complete or skip the charter briefing, inspect Luna's resources, and resolve a
sol. Balance food, water, oxygen, power, and money. Build infrastructure, conduct
research, and move crew and cargo through changing launch windows.

Best on desktop with a mouse; fullscreen is recommended. Drag to pan and scroll
to zoom. E resolves a sol; F opens Fleet; R Research; H Help. Music is opt-in.
Saves and manual slots are browser-local; clearing site storage removes them.
The save schema remains version 1. Back up important saves before upgrading.

## Run Locally

Use Node.js 22+ and npm:

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Open the loopback URL printed by Vite. Serve the built `dist` directory over
HTTP; do not open `index.html` as a file URL. No model, API account, or cloud
service is needed to play. The release ZIP has `index.html` at its root and
uses relative asset paths for embedded HTML5 hosting.

The test runner executes 23 focused suites. Tests and campaign simulations are
regression checks, not independent human usability or scientific validation.
The build type-checks the game and stages licensing and media notices.

## Community and Licensing

Free to download, play, study, modify, and share subject to the full terms.
Private internal use stays free regardless of company revenue. Schools,
universities, and nonprofit educational institutions can host for genuine
teaching and research regardless of revenue. Other companies with **more than
US$1 million annual gross revenue** need a separate written license to host
their own publicly playable copy. Linking to the official game or embedding
its authorized player is not hosting one's own copy.

This is **source-available**, not unrestricted or OSI-approved open source.
Earlier grants and separately licensed components retain their own terms.
See [LICENSE](LICENSE), [LICENSING.md](LICENSING.md), and the release-bound
[checkpoint](LICENSING_CHECKPOINT.json). Licensing inquiries:
[Titans Forge](https://titans-forge.itch.io/).

Private transcripts, launchers, credentials, and operational receipts are not
included. [SOURCE_SNAPSHOT.json](SOURCE_SNAPSHOT.json) records current source
hashes; [media inventory](docs/MEDIA_PROVENANCE_PUBLIC.json) records asset hashes.
Earlier licensing records remain in `docs/licensing-history/`.
