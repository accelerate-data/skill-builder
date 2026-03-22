# Troubleshooting

## Common failures

- Missing configuration causes startup failures
- Invalid payload shapes break downstream parsing
- Long-running syncs should time out with a clear recovery step

## Recovery steps

1. Confirm required settings are present.
2. Re-run the failing action with logging enabled.
3. Add a regression test before shipping the fix.
