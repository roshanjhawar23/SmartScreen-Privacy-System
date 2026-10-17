# Security Policy

## Security Boundaries & Design

SmartScreen Privacy Suite provides defensive visual concealment (curtains) and automated session locking.

Key security boundaries to understand:
1. **Curtains Are Not Kernel Enclaves**: An OS overlay window obscures the screen visually from physical onlookers, but does not isolate memory from compromised software already executing with user privileges.
2. **Heuristic Anti-Spoofing**: Texture, motion, and frequency liveness checks reduce photo/screen presentation attacks but are heuristic defenses.
3. **Local-Only Processing**: Biometric embeddings and threat evaluations remain strictly on-device. No telemetry, audio, or video streams leave your machine.
4. **Fail-Closed Protection**: Any crash, camera disconnect, or unexpected monitoring termination engages the privacy curtain immediately.

## Reporting a Vulnerability

If you discover a security vulnerability or bypass, please report it responsibly:
- **Email**: Open a private advisory on GitHub or contact the maintainer directly.
- **Biometric Data**: Never include raw biometric templates or cleartext security photos in bug reports or public disclosures.
- **Response Target**: Vulnerabilities will be acknowledged within 48 hours and investigated promptly.
