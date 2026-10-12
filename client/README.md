# RotoMonsterAlerts.Client

C# client for alerts.rotomonster.com. Targets .NET Standard 2.0, so it works from Basketball Monster (.NET Framework 4.6.1+) and the monitors (.NET 10).

```csharp
var alerts = new RotoMonsterAlertsClient(apiKey);

await alerts.SendNewsAsync(Sport.NBA, "Trade: X to Y", "Details...", level: AlertLevel.High);
await alerts.SendPlayerAlertAsync(Sport.NBA, "LeBron James LAL F", "Questionable", "#F5A623", ownerUserIds: ownerIds);
await alerts.SendStaffAsync("Twitter ingest failed", "Timed out after 30s");

await alerts.AddCodeAsync("ABC123", userId: "12345");
await alerts.SetStaffAsync("ABC123", true);
await alerts.DeleteCodeAsync("ABC123");

await alerts.UpdateMessageAsync(messageId, new UpdateMessageRequest { Status = "Out" });
await alerts.DeleteMessageAsync(messageId);
```

Errors throw `RotoMonsterAlertsException` with the HTTP status and the server's error text. `IsHealthyAsync` never throws.

On .NET Framework, make sure TLS 1.2 is enabled:
`ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;`

Smoke test against the live API (adds and removes a test code, sends one silent staff-only message and deletes it):

```bash
ALERTS_KEY=... dotnet run --project RotoMonsterAlerts.Client.Smoke
```
