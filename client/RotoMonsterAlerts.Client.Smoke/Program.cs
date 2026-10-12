using RotoMonsterAlerts.Client;

var key = Environment.GetEnvironmentVariable("ALERTS_KEY");
var url = Environment.GetEnvironmentVariable("ALERTS_URL") ?? RotoMonsterAlertsClient.DefaultBaseUrl;
if (string.IsNullOrWhiteSpace(key))
{
    Console.WriteLine("Set ALERTS_KEY first");
    return 1;
}

var client = new RotoMonsterAlertsClient(key, url);
var failures = 0;

async Task Step(string name, Func<Task<string>> run)
{
    try
    {
        Console.WriteLine($"PASS  {name}: {await run()}");
    }
    catch (Exception ex)
    {
        failures++;
        Console.WriteLine($"FAIL  {name}: {ex.Message}");
    }
}

const string testCode = "CLIENTSMOKE";

await Step("health", async () => (await client.IsHealthyAsync()).ToString());
await Step("codes", async () => (await client.GetCodesAsync()).Count + " codes");
await Step("devices", async () => (await client.GetDevicesAsync()).Count + " devices");
await Step("add code", async () => (await client.AddCodeAsync(testCode, "smoke-user", "client smoke test")).ToString());
await Step("set user", async () => { await client.SetCodeUserAsync(testCode, "smoke-user-2"); return "ok"; });
await Step("set staff", async () => (await client.SetStaffAsync(testCode, true)).ToString());
await Step("read back", async () =>
{
    var c = (await client.GetCodesAsync()).First(x => x.Code == testCode);
    return $"user={c.UserId} staff={c.IsStaff}";
});
await Step("delete code", async () => (await client.DeleteCodeAsync(testCode)).ToString());

string messageId = null;
await Step("send staff (silent)", async () =>
{
    var r = await client.SendStaffAsync("Client smoke test", "Safe to ignore", notify: false);
    messageId = r.MessageId;
    return messageId;
});
await Step("update", async () => (await client.UpdateMessageAsync(messageId, new UpdateMessageRequest { Body = "Updated by smoke test", Level = AlertLevel.Low })).ToString());
await Step("read messages", async () =>
{
    var m = (await client.GetMessagesAsync(1)).FirstOrDefault(x => x.MessageId == messageId);
    return m == null ? throw new Exception("message not found") : $"{m.Title} / {m.Body} / {m.Level}";
});
await Step("delete message", async () => (await client.DeleteMessageAsync(messageId)).ToString());
await Step("bad code rejected", async () =>
{
    try { await client.SetCodeUserAsync("NO_SUCH_CODE_XYZ", "x"); }
    catch (RotoMonsterAlertsException ex) { return $"{(int)ex.StatusCode} {ex.Message}"; }
    throw new Exception("expected an error");
});

Console.WriteLine(failures == 0 ? "ALL PASSED" : $"{failures} FAILED");
return failures == 0 ? 0 : 1;
