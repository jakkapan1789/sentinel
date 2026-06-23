using System.Net;

namespace SentinelWhitelist.Api.Util;

public static class IpRange
{
    /// <summary>Compute the inclusive start/end address bytes for an IP or CIDR.</summary>
    public static (byte[]? Start, byte[]? End) FromCidr(string value)
    {
        try
        {
            value = value.Trim();
            if (!value.Contains('/'))
            {
                var single = IPAddress.Parse(value).GetAddressBytes();
                return (single, single);
            }

            var net = IPNetwork.Parse(value); // .NET 8
            var start = net.BaseAddress.GetAddressBytes();
            var end = (byte[])start.Clone();
            var hostBits = (start.Length * 8) - net.PrefixLength;
            for (var i = 0; i < hostBits; i++)
            {
                var idx = end.Length - 1 - (i / 8);
                end[idx] |= (byte)(1 << (i % 8));
            }
            return (start, end);
        }
        catch
        {
            return (null, null);
        }
    }

    /// <summary>True if the address is inside the CIDR. Unparseable CIDR / null IP is treated as allowed.</summary>
    public static bool IsInCidr(IPAddress? ip, string cidr)
    {
        if (ip is null) return true;
        try
        {
            return IPNetwork.Parse(cidr.Trim()).Contains(ip);
        }
        catch
        {
            return true;
        }
    }
}
