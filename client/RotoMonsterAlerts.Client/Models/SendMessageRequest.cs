using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

namespace RotoMonsterAlerts.Client
{
    public class SendMessageRequest
    {
        [JsonProperty("sportId", NullValueHandling = NullValueHandling.Ignore)]
        public Sport? Sport { get; set; }

        [JsonProperty("title")]
        public string Title { get; set; }

        [JsonProperty("body", NullValueHandling = NullValueHandling.Ignore)]
        public string Body { get; set; }

        [JsonProperty("url", NullValueHandling = NullValueHandling.Ignore)]
        public string Url { get; set; }

        [JsonProperty("notify")]
        public bool Notify { get; set; } = true;

        [JsonProperty("level", NullValueHandling = NullValueHandling.Ignore)]
        [JsonConverter(typeof(StringEnumConverter), typeof(CamelCaseNamingStrategy))]
        public AlertLevel? Level { get; set; }

        [JsonProperty("status", NullValueHandling = NullValueHandling.Ignore)]
        public string Status { get; set; }

        [JsonProperty("statusColor", NullValueHandling = NullValueHandling.Ignore)]
        public string StatusColor { get; set; }

        [JsonProperty("ownerUserIds", NullValueHandling = NullValueHandling.Ignore)]
        public List<string> OwnerUserIds { get; set; }

        [JsonProperty("staffOnly")]
        public bool StaffOnly { get; set; }
    }
}
