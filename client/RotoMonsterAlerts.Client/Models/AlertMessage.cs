using System;
using Newtonsoft.Json;

namespace RotoMonsterAlerts.Client
{
    public class AlertMessage
    {
        [JsonProperty("message_id")]
        public string MessageId { get; set; }

        [JsonProperty("sport_id")]
        public Sport? Sport { get; set; }

        [JsonProperty("title")]
        public string Title { get; set; }

        [JsonProperty("body")]
        public string Body { get; set; }

        [JsonProperty("url")]
        public string Url { get; set; }

        [JsonProperty("level")]
        public string Level { get; set; }

        [JsonProperty("status")]
        public string Status { get; set; }

        [JsonProperty("status_color")]
        public string StatusColor { get; set; }

        [JsonProperty("is_player")]
        public bool IsPlayer { get; set; }

        [JsonProperty("mine")]
        public bool Mine { get; set; }

        [JsonProperty("created_at")]
        public DateTime CreatedAt { get; set; }
    }
}
