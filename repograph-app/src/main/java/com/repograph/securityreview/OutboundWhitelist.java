package com.repograph.securityreview;

import java.util.List;

/**
 * 出站目标白名单匹配器。
 *
 * <p>条目支持 IPv4 地址、IPv4 CIDR 网段（{@code a.b.c.d/n}）和任意字符串（按原文精确匹配）。
 * 无法解析为 IPv4 的目标只做精确匹配，不猜测语义。
 *
 * @author leolu
 */
final class OutboundWhitelist {

    private final List<String> entries;

    /**
     * 创建白名单。
     *
     * @param entries 白名单条目
     */
    OutboundWhitelist(List<String> entries) {
        this.entries = entries == null ? List.of() : List.copyOf(entries);
    }

    /**
     * 判断目标是否在白名单内。
     *
     * @param destination 目标地址或字符串
     * @return 命中白名单返回 true
     */
    boolean contains(String destination) {
        if (destination == null || entries.isEmpty()) {
            return false;
        }
        for (String entry : entries) {
            if (entry.equals(destination)) {
                return true;
            }
            Long cidrMask = cidrMaskOf(entry);
            if (cidrMask != null && matchesCidr(destination, entry, cidrMask)) {
                return true;
            }
        }
        return false;
    }

    private Long cidrMaskOf(String entry) {
        int slash = entry.indexOf('/');
        if (slash <= 0) {
            return null;
        }
        Long base = ipv4ToLong(entry.substring(0, slash));
        int prefix;
        try {
            prefix = Integer.parseInt(entry.substring(slash + 1));
        } catch (NumberFormatException error) {
            return null;
        }
        if (base == null || prefix < 0 || prefix > 32) {
            return null;
        }
        long mask = prefix == 0 ? 0L : (0xFFFFFFFFL << (32 - prefix)) & 0xFFFFFFFFL;
        return (base & mask) << 32 | mask;
    }

    private boolean matchesCidr(String destination, String entry, long packed) {
        Long ip = ipv4ToLong(destination);
        if (ip == null) {
            return false;
        }
        long network = packed >>> 32;
        long mask = packed & 0xFFFFFFFFL;
        return (ip & mask) == network;
    }

    private Long ipv4ToLong(String value) {
        if (value == null) {
            return null;
        }
        String[] parts = value.split("\\.");
        if (parts.length != 4) {
            return null;
        }
        long result = 0;
        for (String part : parts) {
            int octet;
            try {
                octet = Integer.parseInt(part);
            } catch (NumberFormatException error) {
                return null;
            }
            if (octet < 0 || octet > 255) {
                return null;
            }
            result = result << 8 | octet;
        }
        return result;
    }
}
