# Contributing to SmartScreen Privacy Suite

Thank you for helping improve SmartScreen Privacy Suite. Please follow these guidelines:

## Development Setup

1. **Prerequisites**: Windows 10/11, Node.js 20+, Python 3.11+.
2. **Install dependencies**:
   ```powershell
   npm install
   pip install -r backend/requirements.txt
   ```
3. **Run local app**:
   ```powershell
   npm start
   ```

## Testing Requirements

All PRs must pass the test suites before merging:
```powershell
npm test
python -m pytest backend/tests -v
```

For end-to-end integration tests:
```powershell
npm run test:e2e
```

## Critical Rules

- **Zero Biometric Data in Git**: Never commit `.enc`, `.npy`, raw camera captures, or enrolled biometric templates. The repository enforces fail-closed privacy by design.
- **Fail-Closed Principle**: Modifications to watchdog, presence detection, or curtain logic must fail safe (concealing the screen if an error occurs).
- **Keep PRs Focused**: Keep changes scoped, well-documented, and covered by automated tests.
