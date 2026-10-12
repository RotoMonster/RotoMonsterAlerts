using Newtonsoft.Json;

namespace RotoMonsterAlerts.Client
{
    public class NewCode
    {
        [JsonProperty("code")]
        public string Code { get; set; }

        [JsonProperty("userId", NullValueHandling = NullValueHandling.Ignore)]
        public string UserId { get; set; }

        [JsonProperty("note", NullValueHandling = NullValueHandling.Ignore)]
        public string Note { get; set; }
    }
}
