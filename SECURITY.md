# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email the maintainers or use [GitHub's private vulnerability reporting](https://github.com/althrussell/databricks-sql-genie/security/advisories/new).

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 1 week
- **Fix or mitigation**: best effort, typically within 30 days for critical issues

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | Yes                |

## Security Best Practices for Contributors

- Never commit secrets, tokens, or credentials (`.env`, `credentials.json`, etc.)
- PII redaction is enabled by default — do not disable it without explicit approval
- SQL query text logging must be opt-in, never default-on
- All Databricks connections use service principal OAuth or OBO tokens — never hardcode credentials
