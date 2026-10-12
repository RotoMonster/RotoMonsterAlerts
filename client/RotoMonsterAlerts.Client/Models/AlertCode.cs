using System;
using Newtonsoft.Json;

namespace RotoMonsterAlerts.Client
{
    public class AlertCode
    {
        [JsonProperty("code")]
        public string Code { get; set; }

        [JsonProperty("note")]
        public string Note { get; set; }

        [JsonProperty("user_id")]
        public string UserId { get; set; }

        [JsonProperty("is_staff")]
        public bool IsStaff { get; set; }

        [JsonProperty("registered")]
        public bool Registered { get; set; }

        [JsonProperty("created_at")]
        public DateTime CreatedAt { get; set; }

        [JsonProperty("last_seen")]
        public DateTime? LastSeen { get; set; }
    }
}
