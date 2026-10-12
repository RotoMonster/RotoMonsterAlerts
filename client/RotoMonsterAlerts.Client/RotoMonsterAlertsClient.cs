using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RotoMonsterAlerts.Client
{
    public class RotoMonsterAlertsClient : IRotoMonsterAlertsClient
    {
        public const string DefaultBaseUrl = "https://alerts.rotomonster.com";

        private static readonly HttpClient SharedHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };

        private readonly HttpClient _http;
        private readonly string _baseUrl;
        private readonly string _apiKey;

        public RotoMonsterAlertsClient(string apiKey, string baseUrl = DefaultBaseUrl, HttpClient httpClient = null)
        {
            if (string.IsNullOrWhiteSpace(apiKey))
                throw new ArgumentException("API key is required", nameof(apiKey));

            _apiKey = apiKey;
            _baseUrl = (string.IsNullOrWhiteSpace(baseUrl) ? DefaultBaseUrl : baseUrl).TrimEnd('/');
            _http = httpClient ?? SharedHttp;
        }

        public Task<SendMessageResult> SendMessageAsync(SendMessageRequest request, CancellationToken cancellationToken = default)
        {
            if (request == null)
                throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Title))
                throw new ArgumentException("Title is required", nameof(request));

            return SendAsync<SendMessageResult>(HttpMethod.Post, "/api/message", request, cancellationToken);
        }

        public Task<SendMessageResult> SendNewsAsync(Sport sport, string title, string body = null, string url = null, AlertLevel? level = null, bool notify = true, CancellationToken cancellationToken = default)
        {
            return SendMessageAsync(new SendMessageRequest
            {
                Sport = sport,
                Title = title,
                Body = body,
                Url = url,
                Level = level,
                Notify = notify
            }, cancellationToken);
        }

        public Task<SendMessageResult> SendPlayerAlertAsync(Sport sport, string title, string status, string statusColor = null, IEnumerable<string> ownerUserIds = null, string body = null, string url = null, AlertLevel? level = null, bool notify = true, CancellationToken cancellationToken = default)
        {
            return SendMessageAsync(new SendMessageRequest
            {
                Sport = sport,
                Title = title,
                Status = status,
                StatusColor = statusColor,
                OwnerUserIds = ownerUserIds?.ToList(),
                Body = body,
                Url = url,
                Level = level,
                Notify = notify
            }, cancellationToken);
        }

        public Task<SendMessageResult> SendStaffAsync(string title, string body = null, string url = null, Sport? sport = null, bool notify = true, CancellationToken cancellationToken = default)
        {
            return SendMessageAsync(new SendMessageRequest
            {
                Sport = sport,
                Title = title,
                Body = body,
                Url = url,
                Notify = notify,
                StaffOnly = true
            }, cancellationToken);
        }

        public async Task<bool> UpdateMessageAsync(string messageId, UpdateMessageRequest request, CancellationToken cancellationToken = default)
        {
            if (request == null)
                throw new ArgumentNullException(nameof(request));

            var json = await SendRawAsync(HttpMethod.Put, "/api/messages/" + Escape(messageId), request, cancellationToken, allowNotFound: true).ConfigureAwait(false);
            return json != null;
        }

        public async Task<bool> DeleteMessageAsync(string messageId, CancellationToken cancellationToken = default)
        {
            var json = await SendRawAsync(HttpMethod.Delete, "/api/messages/" + Escape(messageId), null, cancellationToken).ConfigureAwait(false);
            return json.Value<bool?>("deleted") ?? false;
        }

        public async Task<List<AlertMessage>> GetMessagesAsync(int hours = 12, Sport? sport = null, CancellationToken cancellationToken = default)
        {
            var path = "/api/messages?hours=" + hours;
            if (sport.HasValue)
                path += "&sportId=" + (int)sport.Value;

            var json = await SendRawAsync(HttpMethod.Get, path, null, cancellationToken).ConfigureAwait(false);
            return json["messages"]?.ToObject<List<AlertMessage>>() ?? new List<AlertMessage>();
        }

        public async Task<bool> AddCodeAsync(string code, string userId = null, string note = null, CancellationToken cancellationToken = default)
        {
            var added = await AddCodesAsync(new[] { new NewCode { Code = code, UserId = userId, Note = note } }, cancellationToken).ConfigureAwait(false);
            return added > 0;
        }

        public async Task<int> AddCodesAsync(IEnumerable<NewCode> codes, CancellationToken cancellationToken = default)
        {
            var list = codes?.Where(c => c != null && !string.IsNullOrWhiteSpace(c.Code)).ToList();
            if (list == null || list.Count == 0)
                throw new ArgumentException("At least one code is required", nameof(codes));

            var json = await SendRawAsync(HttpMethod.Post, "/api/codes", new { codes = list }, cancellationToken).ConfigureAwait(false);
            return json.Value<int?>("added") ?? 0;
        }

        public async Task<List<AlertCode>> GetCodesAsync(CancellationToken cancellationToken = default)
        {
            var json = await SendRawAsync(HttpMethod.Get, "/api/codes", null, cancellationToken).ConfigureAwait(false);
            return json["codes"]?.ToObject<List<AlertCode>>() ?? new List<AlertCode>();
        }

        public Task SetCodeUserAsync(string code, string userId, CancellationToken cancellationToken = default)
        {
            return SendRawAsync(HttpMethod.Put, "/api/codes/" + Escape(code), new { userId }, cancellationToken);
        }

        public async Task<bool> SetStaffAsync(string code, bool isStaff, CancellationToken cancellationToken = default)
        {
            var json = await SendRawAsync(HttpMethod.Put, "/api/codes/" + Escape(code) + "/staff", new { staff = isStaff }, cancellationToken).ConfigureAwait(false);
            return json.Value<bool?>("updated") ?? false;
        }

        public async Task<bool> DeleteCodeAsync(string code, CancellationToken cancellationToken = default)
        {
            var json = await SendRawAsync(HttpMethod.Delete, "/api/codes/" + Escape(code), null, cancellationToken).ConfigureAwait(false);
            return json.Value<bool?>("deleted") ?? false;
        }

        public async Task<List<AlertDevice>> GetDevicesAsync(CancellationToken cancellationToken = default)
        {
            var json = await SendRawAsync(HttpMethod.Get, "/api/devices", null, cancellationToken).ConfigureAwait(false);
            return json["devices"]?.ToObject<List<AlertDevice>>() ?? new List<AlertDevice>();
        }

        public async Task<bool> IsHealthyAsync(CancellationToken cancellationToken = default)
        {
            try
            {
                var json = await SendRawAsync(HttpMethod.Get, "/api/health", null, cancellationToken).ConfigureAwait(false);
                return json.Value<string>("database") == "connected";
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                return false;
            }
        }

        private async Task<T> SendAsync<T>(HttpMethod method, string path, object body, CancellationToken cancellationToken)
        {
            var json = await SendRawAsync(method, path, body, cancellationToken).ConfigureAwait(false);
            return json.ToObject<T>();
        }

        private async Task<JObject> SendRawAsync(HttpMethod method, string path, object body, CancellationToken cancellationToken, bool allowNotFound = false)
        {
            using (var request = new HttpRequestMessage(method, _baseUrl + path))
            {
                request.Headers.Add("X-API-Key", _apiKey);

                if (body != null)
                    request.Content = new StringContent(JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json");

                using (var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                {
                    var text = response.Content == null ? null : await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                    if (allowNotFound && response.StatusCode == HttpStatusCode.NotFound)
                        return null;

                    JObject json = null;
                    try
                    {
                        if (!string.IsNullOrWhiteSpace(text))
                            json = JObject.Parse(text);
                    }
                    catch (JsonReaderException)
                    {
                    }

                    var ok = response.IsSuccessStatusCode && json != null && (json.Value<bool?>("success") ?? true);
                    if (!ok)
                    {
                        var error = json?.Value<string>("error") ?? ("Alerts API returned " + (int)response.StatusCode);
                        throw new RotoMonsterAlertsException(response.StatusCode, error);
                    }

                    return json;
                }
            }
        }

        private static string Escape(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                throw new ArgumentException("Value is required");
            return Uri.EscapeDataString(value.Trim());
        }
    }
}
