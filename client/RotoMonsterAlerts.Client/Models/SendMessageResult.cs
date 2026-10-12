using Newtonsoft.Json;

namespace RotoMonsterAlerts.Client
{
    public class SendMessageResult
    {
        [JsonProperty("messageId")]
        public string MessageId { get; set; }

        [JsonProperty("notified")]
        public bool Notified { get; set; }

        [JsonProperty("sent")]
        public int Sent { get; set; }

        [JsonProperty("message")]
        public AlertMessage Message { get; set; }
    }
}
