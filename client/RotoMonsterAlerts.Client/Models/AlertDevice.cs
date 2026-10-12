using System;
using Newtonsoft.Json;

namespace RotoMonsterAlerts.Client
{
    public class AlertDevice
    {
        [JsonProperty("code")]
        public string Code { get; set; }

        [JsonProperty("notifications_enabled")]
        public bool NotificationsEnabled { get; set; }

        [JsonProperty("my_players_only")]
        public bool MyPlayersOnly { get; set; }

        [JsonProperty("staff_notifications")]
        public bool StaffNotifications { get; set; }

        [JsonProperty("last_seen")]
        public DateTime LastSeen { get; set; }
    }
}
