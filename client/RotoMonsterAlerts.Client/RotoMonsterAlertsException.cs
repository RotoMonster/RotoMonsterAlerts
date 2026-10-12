using System;
using System.Net;

namespace RotoMonsterAlerts.Client
{
    public class RotoMonsterAlertsException : Exception
    {
        public HttpStatusCode StatusCode { get; }

        public RotoMonsterAlertsException(HttpStatusCode statusCode, string message)
            : base(message)
        {
            StatusCode = statusCode;
        }
    }
}
