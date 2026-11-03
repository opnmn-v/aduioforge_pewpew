# Security policy

This fork is maintained by **opnmn-v** and is based on [Ambient Forge by Marevo](https://github.com/marevoteam-wq/ambient-forge). The original attribution and MIT license are preserved.

The application accepts HTTP(S) media URLs and validates imported libraries and synchronized playback messages. Libraries are stored in the browser; exported `.aforge` files contain source URLs and settings, not the audio files themselves. Media hosts, including Dropbox and YouTube, receive requests directly from each listener's browser. YouTube title lookup also sends a request to YouTube.

Share only source links that you intend room participants to access. Exported libraries can include link access parameters, so avoid publishing personal libraries without reviewing their URLs.

## Reporting a vulnerability in this fork

Use the [Security tab of this repository](https://github.com/opnmn-v/aduioforge_pewpew/security) to submit a private vulnerability report if private reporting is enabled.

If private reporting is unavailable, open an issue in [this repository](https://github.com/opnmn-v/aduioforge_pewpew/issues) requesting a private contact channel. Do not include exploit details, credentials, private media URLs, or personal data in that public request.

In the private report, include the affected commit or version, reproduction steps, expected and actual behavior, potential impact, and any suggested mitigation. Remove credentials and personal data from logs and examples. Coordinate disclosure with the fork maintainer before publishing sensitive details.
