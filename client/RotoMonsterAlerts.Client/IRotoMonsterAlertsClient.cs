using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace RotoMonsterAlerts.Client
{
    public interface IRotoMonsterAlertsClient
    {
        Task<SendMessageResult> SendMessageAsync(SendMessageRequest request, CancellationToken cancellationToken = default);

        Task<SendMessageResult> SendNewsAsync(Sport sport, string title, string body = null, string url = null, AlertLevel? level = null, bool notify = true, CancellationToken cancellationToken = default);

        Task<SendMessageResult> SendPlayerAlertAsync(Sport sport, string title, string status, string statusColor = null, IEnumerable<string> ownerUserIds = null, string body = null, string url = null, AlertLevel? level = null, bool notify = true, CancellationToken cancellationToken = default);

        Task<SendMessageResult> SendStaffAsync(string title, string body = null, string url = null, Sport? sport = null, bool notify = true, CancellationToken cancellationToken = default);

        Task<bool> UpdateMessageAsync(string messageId, UpdateMessageRequest request, CancellationToken cancellationToken = default);

        Task<bool> DeleteMessageAsync(string messageId, CancellationToken cancellationToken = default);

        Task<List<AlertMessage>> GetMessagesAsync(int hours = 12, Sport? sport = null, CancellationToken cancellationToken = default);

        Task<bool> AddCodeAsync(string code, string userId = null, string note = null, CancellationToken cancellationToken = default);

        Task<int> AddCodesAsync(IEnumerable<NewCode> codes, CancellationToken cancellationToken = default);

        Task<List<AlertCode>> GetCodesAsync(CancellationToken cancellationToken = default);

        Task SetCodeUserAsync(string code, string userId, CancellationToken cancellationToken = default);

        Task<bool> SetStaffAsync(string code, bool isStaff, CancellationToken cancellationToken = default);

        Task<bool> DeleteCodeAsync(string code, CancellationToken cancellationToken = default);

        Task<List<AlertDevice>> GetDevicesAsync(CancellationToken cancellationToken = default);

        Task<bool> IsHealthyAsync(CancellationToken cancellationToken = default);
    }
}
