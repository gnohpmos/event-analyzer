<?php
error_reporting(0);

// Helper function to extract IP
function filter_ip($raw_data) {
    $pattern = "/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/";
    if (preg_match($pattern, $raw_data, $match)) {
        return trim($match[1]);
    }
    return null;
}

// Calculate peer IP in /30 or /31 subnet
function get_peer_ip($ip, $netmask) {
    if ($netmask === '255.255.255.252') { // /30
        $ip_long = ip2long($ip);
        $mask_long = ip2long($netmask);
        $net_long = $ip_long & $mask_long;
        $ip1 = $net_long + 1;
        $ip2 = $net_long + 2;
        return ($ip_long === $ip1) ? long2ip($ip2) : long2ip($ip1);
    } elseif ($netmask === '255.255.255.254') { // /31
        $ip_long = ip2long($ip);
        $mask_long = ip2long($netmask);
        $net_long = $ip_long & $mask_long;
        $ip1 = $net_long;
        $ip2 = $net_long + 1;
        return ($ip_long === $ip1) ? long2ip($ip2) : long2ip($ip1);
    }
    return null;
}

// Clean string for safe Mermaid node labels
function clean_mermaid_str($str) {
    $str = str_replace(array('"', "'", '[', ']', '(', ')', '{', '}', '<', '>'), ' ', $str);
    $str = preg_replace('/\s+/', ' ', $str);
    return trim($str);
}

// Shorten interface name (e.g. HundredGigE0/4/0/0 -> Hu0/4/0/0)
function shorten_intf($intf) {
    $intf = preg_replace('/^HundredGigE/i', 'Hu', $intf);
    $intf = preg_replace('/^TenGigabitEthernet/i', 'Te', $intf);
    $intf = preg_replace('/^GigabitEthernet/i', 'Gi', $intf);
    $intf = preg_replace('/^FastEthernet/i', 'Fa', $intf);
    $intf = preg_replace('/^Ethernet/i', 'Eth', $intf);
    return $intf;
}

$start_time = microtime(true);

// Receive inputs
$mode = isset($_POST["mode"]) ? trim($_POST["mode"]) : "general";
$input_gen = isset($_POST["ipaddr"]) ? $_POST["ipaddr"] : "";
$input_fwd = isset($_POST["ipaddr_fwd"]) ? $_POST["ipaddr_fwd"] : "";
$input_ret = isset($_POST["ipaddr_ret"]) ? $_POST["ipaddr_ret"] : "";
$auto_peer = isset($_POST["auto_peer"]) ? intval($_POST["auto_peer"]) : 1;

// Helper to extract Circuit ID
function extract_circuit_id($desc) {
    if (preg_match('/(TBB[0-9A-Z]+)/i', $desc, $m)) {
        return $m[1];
    } elseif (preg_match('/(BE[0-9]+|BUNDLE[0-9]+)/i', $desc, $m)) {
        return $m[1];
    } elseif (preg_match('/(BUNDLE\s+[^\s,:]+)/i', $desc, $m)) {
        return trim($m[1]);
    } elseif (preg_match('/([A-Z0-9_\-]{6,})/i', $desc, $m)) {
        return substr($m[1], 0, 16);
    }
    return '';
}

// Collect IPs and preserve hop sequences
$fwd_hops = array();
$ret_hops = array();
$gen_hops = array();
$ip_directions = array();

if ($mode === "asymmetric" || (!empty($input_fwd) || !empty($input_ret))) {
    $mode = "asymmetric";
    foreach (explode("\n", trim($input_fwd)) as $line) {
        $ip = filter_ip($line);
        if ($ip) {
            $fwd_hops[] = $ip;
            $ip_directions[$ip] = 'forward';
        }
    }
    foreach (explode("\n", trim($input_ret)) as $line) {
        $ip = filter_ip($line);
        if ($ip) {
            $ret_hops[] = $ip;
            if (isset($ip_directions[$ip]) && $ip_directions[$ip] === 'forward') {
                $ip_directions[$ip] = 'both';
            } else {
                $ip_directions[$ip] = 'return';
            }
        }
    }
} else {
    // Mode: General box (Check if user entered #FORWARD / #RETURN tags inside)
    $lines = explode("\n", trim($input_gen));
    $current_tag = 'general';
    $has_tags = false;

    foreach ($lines as $line) {
        $trim_line = strtoupper(trim($line));
        if (strpos($trim_line, '#FORWARD') !== false || strpos($trim_line, '[FORWARD]') !== false || strpos($trim_line, '#FORWORD') !== false) {
            $current_tag = 'forward';
            $has_tags = true;
            continue;
        } elseif (strpos($trim_line, '#RETURN') !== false || strpos($trim_line, '[RETURN]') !== false || strpos($trim_line, '#RETRUN') !== false) {
            $current_tag = 'return';
            $has_tags = true;
            continue;
        }

        $ip = filter_ip($line);
        if ($ip) {
            if ($current_tag === 'forward') {
                $fwd_hops[] = $ip;
            } elseif ($current_tag === 'return') {
                $ret_hops[] = $ip;
            } else {
                $gen_hops[] = $ip;
            }

            if (isset($ip_directions[$ip]) && $ip_directions[$ip] !== $current_tag && $current_tag !== 'general') {
                $ip_directions[$ip] = 'both';
            } else {
                $ip_directions[$ip] = $current_tag;
            }
        }
    }
    if ($has_tags) {
        $mode = "asymmetric";
    }
}

$all_input_ips = array_unique(array_merge($fwd_hops, $ret_hops, $gen_hops));

$con = mysqli_connect("localhost", "root", "ait@1761", "information");
mysqli_set_charset($con, "utf8mb4");

$records = array();
$not_found_ips = array();

if (!empty($all_input_ips) && $con) {
    // 1. Fetch initial IPs from ipwan
    $escaped_ips = array_map(function($ip) use ($con) {
        return "'" . mysqli_real_escape_string($con, $ip) . "'";
    }, $all_input_ips);

    $sql = "SELECT ip_address, ip_loopback, interface, subnet, description, time
            FROM ipwan
            WHERE ip_address IN (" . implode(",", $escaped_ips) . ")
            ORDER BY time DESC";

    $raw_candidates = array();
    $res = mysqli_query($con, $sql);
    if ($res) {
        while ($row = mysqli_fetch_assoc($res)) {
            $raw_candidates[$row['ip_address']][] = $row;
        }
    }

    // Check which input IPs were not found
    foreach ($all_input_ips as $in_ip) {
        if (!isset($raw_candidates[$in_ip])) {
            $not_found_ips[] = $in_ip;
        }
    }

    // 2. Auto-detect Peer IPs if requested
    if ($auto_peer == 1) {
        $peers_to_fetch = array();
        foreach ($raw_candidates as $ip => $rows) {
            foreach ($rows as $r) {
                $peer_ip = get_peer_ip($r['ip_address'], $r['subnet']);
                if ($peer_ip && !isset($raw_candidates[$peer_ip]) && !in_array($peer_ip, $peers_to_fetch)) {
                    $peers_to_fetch[] = $peer_ip;
                }
            }
        }

        if (!empty($peers_to_fetch)) {
            $escaped_peers = array_map(function($ip) use ($con) {
                return "'" . mysqli_real_escape_string($con, $ip) . "'";
            }, $peers_to_fetch);

            $sql_peer = "SELECT ip_address, ip_loopback, interface, subnet, description, time
                        FROM ipwan
                        WHERE ip_address IN (" . implode(",", $escaped_peers) . ")
                        ORDER BY time DESC";

            $res_peer = mysqli_query($con, $sql_peer);
            if ($res_peer) {
                while ($prow = mysqli_fetch_assoc($res_peer)) {
                    $raw_candidates[$prow['ip_address']][] = $prow;
                }
            }
        }
    }

    // 3. Disambiguate records when multiple rows exist for the same IP
    $known_loopbacks = array();
    foreach ($raw_candidates as $ip => $rows) {
        if (count($rows) === 1) {
            $known_loopbacks[$rows[0]['ip_loopback']] = true;
        }
    }

    foreach ($raw_candidates as $ip => $rows) {
        if (count($rows) === 1) {
            $chosen = $rows[0];
        } else {
            // Pick candidate whose loopback is already confirmed in the path
            $chosen = $rows[0];
            foreach ($rows as $cand) {
                if (isset($known_loopbacks[$cand['ip_loopback']])) {
                    $chosen = $cand;
                    break;
                }
            }
            // Disambiguation for 10.127.100.29 (BK-BRKC-CO-CX16-01 / 8808-01 odd bundle 13171 to Ratchaburi)
            if ($ip === '10.127.100.29') {
                foreach ($rows as $cand) {
                    if ($cand['ip_loopback'] === '10.126.0.31') {
                        $chosen = $cand;
                        break;
                    }
                }
            }
        }

        $chosen['is_auto_peer'] = !in_array($ip, $all_input_ips);
        $chosen['direction'] = isset($ip_directions[$ip]) ? $ip_directions[$ip] : 'general';
        $chosen['hostname'] = '';
        $chosen['model'] = '';
        $records[$ip] = $chosen;
    }

    // 4. Fetch Hostname & Model for found Loopbacks
    $loopbacks = array();
    foreach ($records as $r) {
        if (!empty($r['ip_loopback']) && !in_array($r['ip_loopback'], $loopbacks)) {
            $loopbacks[] = "'" . mysqli_real_escape_string($con, $r['ip_loopback']) . "'";
        }
    }

    if (!empty($loopbacks)) {
        $sql_nodes = "SELECT ip_nms, TRIM(hostname) as hostname, TRIM(model) as model 
                      FROM nodeinfo 
                      WHERE ip_nms IN (" . implode(",", $loopbacks) . ") 
                      GROUP BY ip_nms";
        $res_nodes = mysqli_query($con, $sql_nodes);
        if ($res_nodes) {
            $node_map = array();
            while ($nrow = mysqli_fetch_assoc($res_nodes)) {
                $node_map[$nrow['ip_nms']] = $nrow;
            }
            foreach ($records as $rip => $rval) {
                $lo = $rval['ip_loopback'];
                if (isset($node_map[$lo])) {
                    $records[$rip]['hostname'] = $node_map[$lo]['hostname'];
                    $records[$rip]['model'] = $node_map[$lo]['model'];
                }
            }
        }
    }
}

// 5. Build Topology Links from Hop Sequences (Forward & Return)
$links = array();
$seen_links = array(); // track deduplication: "dir:from_lo:to_lo:from_ip:to_ip"

function trace_hop_path($hops, $dir, $records, &$links, &$seen_links) {
    for ($i = 0; $i < count($hops) - 1; $i++) {
        $ip1 = $hops[$i];
        $ip2 = $hops[$i + 1];
        if (!isset($records[$ip1]) || !isset($records[$ip2])) continue;

        $r1 = $records[$ip1];
        $r2 = $records[$ip2];
        $lo1 = $r1['ip_loopback'];
        $lo2 = $r2['ip_loopback'];
        if ($lo1 === $lo2) continue; // Same router internal

        $peer1 = get_peer_ip($ip1, $r1['subnet']);
        $peer2 = get_peer_ip($ip2, $r2['subnet']);

        $from_lo = null; $from_ip = null; $from_intf = null;
        $to_lo = null; $to_ip = null; $to_intf = null;
        $desc = "";

        if ($peer1 === $ip2) {
            // Direct P2P subnet between ip1 and ip2
            $from_lo = $lo1; $from_ip = $ip1; $from_intf = $r1['interface'];
            $to_lo = $lo2; $to_ip = $ip2; $to_intf = $r2['interface'];
            $desc = !empty($r1['description']) ? $r1['description'] : $r2['description'];
        } elseif ($peer2 && isset($records[$peer2]) && $records[$peer2]['ip_loopback'] === $lo1) {
            // Egress on lo1 (peer2) -> Ingress on lo2 (ip2)
            $from_lo = $lo1; $from_ip = $peer2; $from_intf = $records[$peer2]['interface'];
            $to_lo = $lo2; $to_ip = $ip2; $to_intf = $r2['interface'];
            $desc = !empty($records[$peer2]['description']) ? $records[$peer2]['description'] : $r2['description'];
        } elseif ($peer1 && isset($records[$peer1]) && $records[$peer1]['ip_loopback'] === $lo2) {
            // Egress on lo1 (ip1) -> Ingress on lo2 (peer1)
            $from_lo = $lo1; $from_ip = $ip1; $from_intf = $r1['interface'];
            $to_lo = $lo2; $to_ip = $peer1; $to_intf = $records[$peer1]['interface'];
            $desc = !empty($r1['description']) ? $r1['description'] : $records[$peer1]['description'];
        }

        if ($from_lo && $to_lo) {
            $lkey = "$dir:$from_lo:$to_lo:$from_ip:$to_ip";
            if (!isset($seen_links[$lkey])) {
                $seen_links[$lkey] = true;
                $links[] = array(
                    'type' => 'p2p',
                    'direction' => $dir,
                    'dev_a' => $from_lo,
                    'ip_a' => $from_ip,
                    'intf_a' => $from_intf,
                    'dev_b' => $to_lo,
                    'ip_b' => $to_ip,
                    'intf_b' => $to_intf,
                    'circuit' => extract_circuit_id($desc),
                    'description' => $desc
                );
            }
        }
    }
}

if (!empty($fwd_hops)) {
    trace_hop_path($fwd_hops, 'forward', $records, $links, $seen_links);
}
if (!empty($ret_hops)) {
    trace_hop_path($ret_hops, 'return', $records, $links, $seen_links);
}
if (!empty($gen_hops)) {
    trace_hop_path($gen_hops, 'general', $records, $links, $seen_links);
}

// Fallback: Also discover any P2P links between records that weren't captured by hops
$connected_pairs = array();
foreach ($links as $lk) {
    $pair_key = ($lk['ip_a'] < $lk['ip_b']) ? "{$lk['ip_a']}-{$lk['ip_b']}" : "{$lk['ip_b']}-{$lk['ip_a']}";
    $connected_pairs[$pair_key] = true;
}

foreach ($records as $ip => $item) {
    $peer_ip = get_peer_ip($ip, $item['subnet']);
    if ($peer_ip && isset($records[$peer_ip])) {
        $pair_key = ($ip < $peer_ip) ? "$ip-$peer_ip" : "$peer_ip-$ip";
        if (!isset($connected_pairs[$pair_key])) {
            $connected_pairs[$pair_key] = true;
            $peer_item = $records[$peer_ip];
            if ($item['ip_loopback'] !== $peer_item['ip_loopback']) {
                $links[] = array(
                    'type' => 'p2p',
                    'direction' => 'general',
                    'dev_a' => $item['ip_loopback'],
                    'ip_a' => $ip,
                    'intf_a' => $item['interface'],
                    'dev_b' => $peer_item['ip_loopback'],
                    'ip_b' => $peer_ip,
                    'intf_b' => $peer_item['interface'],
                    'circuit' => extract_circuit_id($item['description']),
                    'description' => $item['description']
                );
            }
        }
    }
}

// Standalone links for unmatched IPs
$matched_ips = array();
foreach ($links as $lk) {
    $matched_ips[] = $lk['ip_a'];
    $matched_ips[] = $lk['ip_b'];
}

foreach ($records as $ip => $item) {
    if (!in_array($ip, $matched_ips)) {
        $desc = clean_mermaid_str($item['description']);
        if (strlen($desc) > 30) $desc = substr($desc, 0, 27) . "...";
        $links[] = array(
            'type' => 'standalone',
            'direction' => $item['direction'],
            'dev_a' => $item['ip_loopback'],
            'ip_a' => $ip,
            'intf_a' => $item['interface'],
            'circuit' => '',
            'description' => $desc
        );
    }
}

// 6. Order Router Devices Along the Path
$ordered_loopbacks = array();
foreach ($fwd_hops as $fip) {
    if (isset($records[$fip]['ip_loopback'])) {
        $lo = $records[$fip]['ip_loopback'];
        if (!in_array($lo, $ordered_loopbacks)) $ordered_loopbacks[] = $lo;
    }
}
foreach ($ret_hops as $rip) {
    if (isset($records[$rip]['ip_loopback'])) {
        $lo = $records[$rip]['ip_loopback'];
        if (!in_array($lo, $ordered_loopbacks)) $ordered_loopbacks[] = $lo;
    }
}
foreach ($records as $r) {
    if (!empty($r['ip_loopback']) && !in_array($r['ip_loopback'], $ordered_loopbacks)) {
        $ordered_loopbacks[] = $r['ip_loopback'];
    }
}

$devices = array();
foreach ($ordered_loopbacks as $lo) {
    $dev_recs = array_filter($records, function($item) use ($lo) { return $item['ip_loopback'] === $lo; });
    $first = reset($dev_recs);
    $devices[$lo] = array(
        'loopback' => $lo,
        'hostname' => !empty($first['hostname']) ? $first['hostname'] : $lo,
        'model' => !empty($first['model']) ? $first['model'] : '',
        'interfaces' => $dev_recs
    );
}

// Categorize records for separate Forward and Return tables
$records_fwd = array();
$hop_fwd_idx = 0;
foreach ($fwd_hops as $fip) {
    if (isset($records[$fip]) && !isset($records_fwd[$fip])) {
        $rec = $records[$fip];
        $rec['hop_label'] = "Hop " . ($hop_fwd_idx++);
        $records_fwd[$fip] = $rec;
    }
}
foreach ($links as $lk) {
    if ($lk['direction'] === 'forward') {
        if (isset($records[$lk['ip_a']]) && !isset($records_fwd[$lk['ip_a']])) {
            $rec = $records[$lk['ip_a']];
            $rec['hop_label'] = "Peer";
            $records_fwd[$lk['ip_a']] = $rec;
        }
        if (isset($records[$lk['ip_b']]) && !isset($records_fwd[$lk['ip_b']])) {
            $rec = $records[$lk['ip_b']];
            $rec['hop_label'] = "Peer";
            $records_fwd[$lk['ip_b']] = $rec;
        }
    }
}

$records_ret = array();
$hop_ret_idx = 0;
foreach ($ret_hops as $rip) {
    if (isset($records[$rip]) && !isset($records_ret[$rip])) {
        $rec = $records[$rip];
        $rec['hop_label'] = "Hop " . ($hop_ret_idx++);
        $records_ret[$rip] = $rec;
    }
}
foreach ($links as $lk) {
    if ($lk['direction'] === 'return') {
        if (isset($records[$lk['ip_a']]) && !isset($records_ret[$lk['ip_a']])) {
            $rec = $records[$lk['ip_a']];
            $rec['hop_label'] = "Peer";
            $records_ret[$lk['ip_a']] = $rec;
        }
        if (isset($records[$lk['ip_b']]) && !isset($records_ret[$lk['ip_b']])) {
            $rec = $records[$lk['ip_b']];
            $rec['hop_label'] = "Peer";
            $records_ret[$lk['ip_b']] = $rec;
        }
    }
}

$records_gen = array();
foreach ($records as $ip => $item) {
    if (!isset($records_fwd[$ip]) && !isset($records_ret[$ip])) {
        $records_gen[$ip] = $item;
    }
}
$processed_pairs = $links;

// 7. Generate Mermaid Syntax
$mermaid_lines = array();
$mermaid_lines[] = "flowchart LR";
$mermaid_lines[] = "    classDef router fill:#1e293b,stroke:#0284c7,stroke-width:2px,color:#f8fafc,font-weight:bold;";
$mermaid_lines[] = "    classDef cloud fill:#f8fafc,stroke:#94a3b8,stroke-width:1px,stroke-dasharray: 4 4,color:#475569;";

// Define Device Nodes
$dev_node_map = array();
$dev_counter = 1;
foreach ($devices as $lo => $dev) {
    $node_id = "R" . $dev_counter++;
    $dev_node_map[$lo] = $node_id;

    $host_label = clean_mermaid_str($dev['hostname']);
    $model_label = clean_mermaid_str($dev['model']);
    
    $label = "<b>" . $host_label . "</b><br/>Loopback: " . $lo;
    if (!empty($model_label)) {
        $label .= "<br/><small>(" . $model_label . ")</small>";
    }
    $mermaid_lines[] = "    " . $node_id . "[\"" . $label . "\"]:::router";
}

// Define Links and collect style commands
$cloud_counter = 1;
$link_styles = array();
$link_index = 0;

foreach ($links as $lk) {
    $node_a = isset($dev_node_map[$lk['dev_a']]) ? $dev_node_map[$lk['dev_a']] : null;

    if ($lk['type'] === 'p2p') {
        $node_b = isset($dev_node_map[$lk['dev_b']]) ? $dev_node_map[$lk['dev_b']] : null;
        if ($node_a && $node_b) {
            $intf_a = shorten_intf($lk['intf_a']);
            $intf_b = shorten_intf($lk['intf_b']);

            if ($lk['direction'] === 'forward') {
                $dir_badge = "🔵 <b>ขาไป (Forward)</b><br/>";
                $label = $dir_badge . $intf_a . " (" . $lk['ip_a'] . ") ➔ " . $intf_b . " (" . $lk['ip_b'] . ")";
                if (!empty($lk['circuit'])) {
                    $label .= "<br/>Circuit: " . clean_mermaid_str($lk['circuit']);
                }
                $mermaid_lines[] = "    " . $node_a . " --> |\"" . $label . "\"| " . $node_b;
                $link_styles[] = "    linkStyle $link_index stroke:#2563eb,stroke-width:3px;";
            } elseif ($lk['direction'] === 'return') {
                $dir_badge = "🟠 <b>ขากลับ (Return)</b><br/>";
                $label = $dir_badge . $intf_a . " (" . $lk['ip_a'] . ") ➔ " . $intf_b . " (" . $lk['ip_b'] . ")";
                if (!empty($lk['circuit'])) {
                    $label .= "<br/>Circuit: " . clean_mermaid_str($lk['circuit']);
                }
                $mermaid_lines[] = "    " . $node_a . " -.-> |\"" . $label . "\"| " . $node_b;
                $link_styles[] = "    linkStyle $link_index stroke:#ea580c,stroke-width:3px,stroke-dasharray: 6 4;";
            } else {
                $label = $intf_a . " (" . $lk['ip_a'] . ")<br/>⟷<br/>" . $intf_b . " (" . $lk['ip_b'] . ")";
                if (!empty($lk['circuit'])) {
                    $label = "<b>" . clean_mermaid_str($lk['circuit']) . "</b><br/>" . $label;
                }
                $mermaid_lines[] = "    " . $node_a . " <===> |\"" . $label . "\"| " . $node_b;
                $link_styles[] = "    linkStyle $link_index stroke:#0284c7,stroke-width:2.5px;";
            }
            $link_index++;
        }
    } else {
        if ($node_a) {
            $cloud_id = "Ext" . $cloud_counter++;
            $intf_a = shorten_intf($lk['intf_a']);
            $label = $intf_a . "<br/>" . $lk['ip_a'];
            if (!empty($lk['description'])) {
                $label .= "<br/>" . $lk['description'];
            }

            if ($lk['direction'] === 'forward') {
                $label = "🔵 ขาไป (Forward)<br/>" . $label;
                $mermaid_lines[] = "    " . $cloud_id . "([\"☁️ WAN Peer / Circuit\"]):::cloud";
                $mermaid_lines[] = "    " . $node_a . " --> |\"" . $label . "\"| " . $cloud_id;
                $link_styles[] = "    linkStyle $link_index stroke:#2563eb,stroke-width:3px;";
            } elseif ($lk['direction'] === 'return') {
                $label = "🟠 ขากลับ (Return)<br/>" . $label;
                $mermaid_lines[] = "    " . $cloud_id . "([\"☁️ WAN Peer / Circuit\"]):::cloud";
                $mermaid_lines[] = "    " . $cloud_id . " -.-> |\"" . $label . "\"| " . $node_a;
                $link_styles[] = "    linkStyle $link_index stroke:#ea580c,stroke-width:3px,stroke-dasharray: 6 4;";
            } else {
                $mermaid_lines[] = "    " . $cloud_id . "([\"☁️ WAN Peer / Circuit\"]):::cloud";
                $mermaid_lines[] = "    " . $node_a . " -.-> |\"" . $label . "\"| " . $cloud_id;
                $link_styles[] = "    linkStyle $link_index stroke:#94a3b8,stroke-width:2px;";
            }
            $link_index++;
        }
    }
}

// Append link styles
foreach ($link_styles as $style_line) {
    $mermaid_lines[] = $style_line;
}

$mermaid_code = implode("\n", $mermaid_lines);
$exec_time = round(microtime(true) - $start_time, 3);
?>
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wan2Loopback - Topology & Path Analysis</title>
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Prompt:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <!-- Bootstrap 5 CSS -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <!-- Bootstrap Icons -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
    <!-- Mermaid.js -->
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>

    <style>
        :root {
            --primary-gradient: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
            --accent-color: #0284c7;
            --bg-color: #f8fafc;
            --card-shadow: 0 4px 14px 0 rgba(0, 0, 0, 0.06);
        }

        body {
            font-family: 'Prompt', 'Inter', sans-serif;
            background-color: var(--bg-color);
            color: #0f172a;
            min-height: 100vh;
        }

        .navbar-custom {
            background: var(--primary-gradient);
            color: white;
            box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
        }

        .stat-card {
            background: white;
            border-radius: 1rem;
            border: 1px solid #e2e8f0;
            box-shadow: var(--card-shadow);
            padding: 1.25rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            transition: transform 0.15s ease;
        }

        .stat-card:hover {
            transform: translateY(-2px);
        }

        .stat-icon {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
        }

        .nav-pills .nav-link {
            border-radius: 0.75rem;
            padding: 0.6rem 1.25rem;
            font-weight: 500;
            color: #64748b;
            border: 1px solid transparent;
            transition: all 0.15s ease;
        }

        .nav-pills .nav-link.active {
            background-color: #0284c7;
            color: white;
            box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);
        }

        .diagram-container {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 1rem;
            box-shadow: var(--card-shadow);
            padding: 2rem;
            min-height: 460px;
            overflow: auto;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .table-custom {
            border-collapse: separate;
            border-spacing: 0;
            border-radius: 0.75rem;
            overflow: hidden;
            border: 1px solid #e2e8f0;
        }

        .table-custom thead th {
            background-color: #f1f5f9;
            color: #475569;
            font-weight: 600;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 2px solid #cbd5e1;
            padding: 0.85rem 1rem;
        }

        .table-custom tbody td {
            padding: 0.85rem 1rem;
            vertical-align: middle;
            border-bottom: 1px solid #e2e8f0;
            font-size: 0.92rem;
        }

        .table-custom tbody tr:hover {
            background-color: #f8fafc;
        }

        .badge-ip {
            font-family: 'JetBrains Mono', monospace;
            font-weight: 500;
            letter-spacing: -0.3px;
        }

        .copy-btn {
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.15s ease;
        }

        .copy-btn:hover {
            opacity: 1;
            color: #0284c7;
        }

        .code-box {
            font-family: 'JetBrains Mono', monospace;
            background: #0f172a;
            color: #e2e8f0;
            border-radius: 0.75rem;
            padding: 1.25rem;
            font-size: 0.88rem;
            max-height: 500px;
            overflow: auto;
        }

        .path-legend {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 0.75rem;
            padding: 0.5rem 1rem;
            display: inline-flex;
            align-items: center;
            gap: 1.25rem;
            font-size: 0.85rem;
        }
    </style>
</head>
<body>

    <!-- Top Navigation Bar -->
    <nav class="navbar navbar-custom py-3">
        <div class="container-fluid px-4 d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center gap-3">
                <a href="wan2lo0.html" class="btn btn-outline-light btn-sm rounded-pill px-3">
                    <i class="bi bi-arrow-left me-1"></i> ย้อนกลับ
                </a>
                <span class="fs-5 fw-bold"><i class="bi bi-diagram-3-fill text-info me-2"></i>Wan2Loopback</span>
                <?php if ($mode === 'asymmetric'): ?>
                    <span class="badge bg-warning text-dark rounded-pill px-2.5 py-1">
                        <i class="bi bi-arrow-left-right me-1"></i> Forward/Return Mode
                    </span>
                <?php else: ?>
                    <span class="badge bg-primary-subtle text-info border border-info rounded-pill px-2.5 py-1">General Mode</span>
                <?php endif; ?>
            </div>
            <div class="d-flex align-items-center gap-2">
                <button class="btn btn-light btn-sm rounded-pill fw-medium" data-bs-toggle="modal" data-bs-target="#searchModal">
                    <i class="bi bi-search me-1"></i> ค้นหาใหม่
                </button>
            </div>
        </div>
    </nav>

    <!-- Main Container -->
    <div class="container-fluid px-4 py-4">

        <!-- Stat Row -->
        <div class="row g-3 mb-4">
            <div class="col-6 col-md-3">
                <div class="stat-card">
                    <div class="stat-icon bg-primary-subtle text-primary">
                        <i class="bi bi-search"></i>
                    </div>
                    <div>
                        <div class="text-muted small">IPs ค้นหาทั้งหมด</div>
                        <div class="fs-4 fw-bold"><?php echo count($all_input_ips); ?></div>
                    </div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="stat-card">
                    <div class="stat-icon bg-success-subtle text-success">
                        <i class="bi bi-router"></i>
                    </div>
                    <div>
                        <div class="text-muted small">Routers ที่พบ (Loopback)</div>
                        <div class="fs-4 fw-bold"><?php echo count($devices); ?></div>
                    </div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="stat-card">
                    <div class="stat-icon bg-info-subtle text-info">
                        <i class="bi bi-link-45deg"></i>
                    </div>
                    <div>
                        <div class="text-muted small">Point-to-Point Links</div>
                        <div class="fs-4 fw-bold"><?php echo count($processed_pairs); ?></div>
                    </div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="stat-card">
                    <div class="stat-icon bg-warning-subtle text-warning">
                        <i class="bi bi-clock-history"></i>
                    </div>
                    <div>
                        <div class="text-muted small">ประมวลผลเสร็จใน</div>
                        <div class="fs-4 fw-bold"><?php echo $exec_time; ?>s</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Alert if some IPs not found -->
        <?php if (!empty($not_found_ips)): ?>
            <div class="alert alert-warning alert-dismissible fade show rounded-3 mb-4" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                <strong>ไม่พบข้อมูลในตาราง ipwan จำนวน <?php echo count($not_found_ips); ?> รายการ:</strong> 
                <code><?php echo implode(", ", $not_found_ips); ?></code>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        <?php endif; ?>

        <!-- Path Legend & Toolbar -->
        <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
            <ul class="nav nav-pills" id="pills-tab" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active" id="pills-diagram-tab" data-bs-toggle="pill" data-bs-target="#pills-diagram" type="button" role="tab">
                        <i class="bi bi-diagram-3 me-1"></i> ผังเน็ตเวิร์ก (Topology Diagram)
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="pills-table-tab" data-bs-toggle="pill" data-bs-target="#pills-table" type="button" role="tab">
                        <i class="bi bi-table me-1"></i> ตารางข้อมูลละเอียด (Data Table)
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="pills-code-tab" data-bs-toggle="pill" data-bs-target="#pills-code" type="button" role="tab">
                        <i class="bi bi-code-slash me-1"></i> โค้ด Mermaid
                    </button>
                </li>
            </ul>

            <div class="d-flex flex-wrap align-items-center gap-2">
                <!-- Legend for Path Colors -->
                <?php if ($mode === 'asymmetric'): ?>
                    <div class="path-legend">
                        <span><i class="bi bi-arrow-right text-primary fs-6"></i> <strong>เส้นทึบสีน้ำเงิน</strong>: ขาไป (Forward)</span>
                        <span><i class="bi bi-dash text-warning-emphasis fs-6"></i> <strong>เส้นประสีส้ม</strong>: ขากลับ (Return)</span>
                    </div>
                <?php endif; ?>

                <div class="d-flex align-items-center gap-2">
                    <button class="btn btn-outline-secondary btn-sm rounded-pill" onclick="copyMermaidCode()">
                        <i class="bi bi-clipboard me-1"></i> Copy Code
                    </button>
                    <button class="btn btn-outline-primary btn-sm rounded-pill" onclick="downloadJPG()">
                        <i class="bi bi-file-earmark-image me-1"></i> Download JPG
                    </button>
                </div>
            </div>
        </div>

        <!-- Tab Content -->
        <div class="tab-content" id="pills-tabContent">

            <!-- Tab 1: Mermaid Topology Diagram -->
            <div class="tab-pane fade show active" id="pills-diagram" role="tabpanel">
                <div class="diagram-container position-relative">
                    <?php if (empty($records)): ?>
                        <div class="text-center text-muted py-5">
                            <i class="bi bi-search fs-1 d-block mb-3 text-secondary"></i>
                            <h5>ไม่พบข้อมูลสำหรับการสร้าง Diagram</h5>
                            <p class="small">กรุณากดปุ่ม "ค้นหาใหม่" ด้านบนเพื่อระบุ IP-WAN</p>
                        </div>
                    <?php else: ?>
                        <div class="text-center w-100" id="mermaidGraph">
                            <div class="spinner-border text-primary my-5" role="status">
                                <span class="visually-hidden">กำลังสร้าง Topology Diagram...</span>
                            </div>
                        </div>
                    <?php endif; ?>
                </div>
            </div>

            <!-- Tab 2: Detailed Data Table -->
            <div class="tab-pane fade" id="pills-table" role="tabpanel">
                <div class="card border-0 shadow-sm rounded-3 p-3">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div class="input-group" style="max-width: 320px;">
                            <span class="input-group-text bg-light border-end-0"><i class="bi bi-search text-muted"></i></span>
                            <input type="text" id="tableFilter" class="form-control border-start-0 ps-0" placeholder="พิมพ์เพื่อค้นหาในตาราง...">
                        </div>
                        <button class="btn btn-outline-success btn-sm rounded-pill" onclick="exportTableToCSV('wan2loopback_result.csv')">
                            <i class="bi bi-file-earmark-excel me-1"></i> Export CSV
                        </button>
                    </div>

                    <?php if ($mode === 'asymmetric' || (!empty($records_fwd) || !empty($records_ret))): ?>
                        <!-- Forward Path Table -->
                        <div class="mb-4">
                            <div class="d-flex align-items-center gap-2 mb-2 p-2 bg-primary-subtle rounded-3 border border-primary-subtle">
                                <span class="fs-5 text-primary ms-1"><i class="bi bi-arrow-right-circle-fill"></i></span>
                                <h6 class="fw-bold mb-0 text-primary">ตารางเส้นทางขาไป (Forward Path)</h6>
                                <span class="badge bg-primary text-white rounded-pill px-2.5 py-1 ms-auto"><?php echo count($records_fwd); ?> รายการ</span>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-custom table-hover result-table" id="tableForward">
                                    <thead>
                                        <tr>
                                            <th style="width: 50px;">#</th>
                                            <th style="width: 110px;">Hop</th>
                                            <th>IP-WAN</th>
                                            <th>Device (LoopBack 0)</th>
                                            <th>Hostname / Model</th>
                                            <th>Interface</th>
                                            <th>Description</th>
                                            <th>Last Update</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <?php if (empty($records_fwd)): ?>
                                            <tr><td colspan="8" class="text-center text-muted py-3">ไม่มีข้อมูลเส้นทางขาไป</td></tr>
                                        <?php else: ?>
                                            <?php $f_idx = 1; foreach ($records_fwd as $row): ?>
                                                <tr>
                                                    <td class="text-muted small"><?php echo $f_idx++; ?></td>
                                                    <td>
                                                        <span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2.5 py-1.5 rounded-pill fw-semibold">
                                                            <i class="bi bi-arrow-right-short me-0.5"></i><?php echo htmlspecialchars($row['hop_label']); ?>
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span class="badge bg-primary-subtle text-primary badge-ip p-2">
                                                            <?php echo htmlspecialchars($row['ip_address']); ?>
                                                        </span>
                                                        <i class="bi bi-clipboard copy-btn ms-1" onclick="copyText('<?php echo $row['ip_address']; ?>')" title="คัดลอก IP"></i>
                                                        <?php if ($row['is_auto_peer']): ?>
                                                            <span class="badge bg-info-subtle text-info rounded-pill ms-1" title="ตรวจหาคู่ใน Subnet อัตโนมัติ">Auto-Peer</span>
                                                        <?php endif; ?>
                                                    </td>
                                                    <td>
                                                        <span class="badge bg-secondary-subtle text-dark badge-ip p-2">
                                                            <?php echo htmlspecialchars($row['ip_loopback']); ?>
                                                        </span>
                                                        <i class="bi bi-clipboard copy-btn ms-1" onclick="copyText('<?php echo $row['ip_loopback']; ?>')" title="คัดลอก Loopback"></i>
                                                    </td>
                                                    <td>
                                                        <strong><?php echo htmlspecialchars(!empty($row['hostname']) ? $row['hostname'] : '-'); ?></strong>
                                                        <?php if (!empty($row['model'])): ?>
                                                            <div class="text-muted small"><?php echo htmlspecialchars($row['model']); ?></div>
                                                        <?php endif; ?>
                                                    </td>
                                                    <td>
                                                        <span class="badge bg-light text-dark border">
                                                            <?php echo htmlspecialchars($row['interface']); ?>
                                                        </span>
                                                    </td>
                                                    <td class="text-break" style="max-width: 320px;">
                                                        <?php echo htmlspecialchars($row['description']); ?>
                                                    </td>
                                                    <td class="text-muted small"><?php echo htmlspecialchars($row['time']); ?></td>
                                                </tr>
                                            <?php endforeach; ?>
                                        <?php endif; ?>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Return Path Table -->
                        <div class="mb-4">
                            <div class="d-flex align-items-center gap-2 mb-2 p-2 bg-warning-subtle rounded-3 border border-warning-subtle">
                                <span class="fs-5 text-warning ms-1"><i class="bi bi-arrow-left-circle-fill"></i></span>
                                <h6 class="fw-bold mb-0 text-warning-emphasis">ตารางเส้นทางขากลับ (Return Path)</h6>
                                <span class="badge bg-warning text-dark rounded-pill px-2.5 py-1 ms-auto"><?php echo count($records_ret); ?> รายการ</span>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-custom table-hover result-table" id="tableReturn">
                                    <thead>
                                        <tr>
                                            <th style="width: 50px;">#</th>
                                            <th style="width: 110px;">Hop</th>
                                            <th>IP-WAN</th>
                                            <th>Device (LoopBack 0)</th>
                                            <th>Hostname / Model</th>
                                            <th>Interface</th>
                                            <th>Description</th>
                                            <th>Last Update</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <?php if (empty($records_ret)): ?>
                                            <tr><td colspan="8" class="text-center text-muted py-3">ไม่มีข้อมูลเส้นทางขากลับ</td></tr>
                                        <?php else: ?>
                                            <?php $r_idx = 1; foreach ($records_ret as $row): ?>
                                                <tr>
                                                    <td class="text-muted small"><?php echo $r_idx++; ?></td>
                                                    <td>
                                                        <span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2.5 py-1.5 rounded-pill fw-semibold">
                                                            <i class="bi bi-arrow-left-short me-0.5"></i><?php echo htmlspecialchars($row['hop_label']); ?>
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span class="badge bg-warning-subtle text-warning-emphasis badge-ip p-2">
                                                            <?php echo htmlspecialchars($row['ip_address']); ?>
                                                        </span>
                                                        <i class="bi bi-clipboard copy-btn ms-1" onclick="copyText('<?php echo $row['ip_address']; ?>')" title="คัดลอก IP"></i>
                                                        <?php if ($row['is_auto_peer']): ?>
                                                            <span class="badge bg-info-subtle text-info rounded-pill ms-1" title="ตรวจหาคู่ใน Subnet อัตโนมัติ">Auto-Peer</span>
                                                        <?php endif; ?>
                                                    </td>
                                                    <td>
                                                        <span class="badge bg-secondary-subtle text-dark badge-ip p-2">
                                                            <?php echo htmlspecialchars($row['ip_loopback']); ?>
                                                        </span>
                                                        <i class="bi bi-clipboard copy-btn ms-1" onclick="copyText('<?php echo $row['ip_loopback']; ?>')" title="คัดลอก Loopback"></i>
                                                    </td>
                                                    <td>
                                                        <strong><?php echo htmlspecialchars(!empty($row['hostname']) ? $row['hostname'] : '-'); ?></strong>
                                                        <?php if (!empty($row['model'])): ?>
                                                            <div class="text-muted small"><?php echo htmlspecialchars($row['model']); ?></div>
                                                        <?php endif; ?>
                                                    </td>
                                                    <td>
                                                        <span class="badge bg-light text-dark border">
                                                            <?php echo htmlspecialchars($row['interface']); ?>
                                                        </span>
                                                    </td>
                                                    <td class="text-break" style="max-width: 320px;">
                                                        <?php echo htmlspecialchars($row['description']); ?>
                                                    </td>
                                                    <td class="text-muted small"><?php echo htmlspecialchars($row['time']); ?></td>
                                                </tr>
                                            <?php endforeach; ?>
                                        <?php endif; ?>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- General / Unmatched IPs if any -->
                        <?php if (!empty($records_gen)): ?>
                        <div class="mb-2">
                            <div class="d-flex align-items-center gap-2 mb-2 p-2 bg-light rounded-3 border">
                                <span class="fs-5 text-secondary ms-1"><i class="bi bi-hdd-network"></i></span>
                                <h6 class="fw-bold mb-0 text-secondary">รายการ IP อื่นๆ / Auto-Peer</h6>
                                <span class="badge bg-secondary text-white rounded-pill px-2.5 py-1 ms-auto"><?php echo count($records_gen); ?> รายการ</span>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-custom table-hover result-table" id="tableGen">
                                    <thead>
                                        <tr>
                                            <th style="width: 50px;">#</th>
                                            <th style="width: 110px;">สถานะ</th>
                                            <th>IP-WAN</th>
                                            <th>Device (LoopBack 0)</th>
                                            <th>Hostname / Model</th>
                                            <th>Interface</th>
                                            <th>Description</th>
                                            <th>Last Update</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <?php $g_idx = 1; foreach ($records_gen as $row): ?>
                                            <tr>
                                                <td class="text-muted small"><?php echo $g_idx++; ?></td>
                                                <td>
                                                    <span class="badge bg-light text-secondary border px-2.5 py-1 rounded-pill">
                                                        ทั่วไป (General)
                                                    </span>
                                                </td>
                                                <td>
                                                    <span class="badge bg-primary-subtle text-primary badge-ip p-2">
                                                        <?php echo htmlspecialchars($row['ip_address']); ?>
                                                    </span>
                                                    <i class="bi bi-clipboard copy-btn ms-1" onclick="copyText('<?php echo $row['ip_address']; ?>')" title="คัดลอก IP"></i>
                                                    <?php if ($row['is_auto_peer']): ?>
                                                        <span class="badge bg-info-subtle text-info rounded-pill ms-1">Auto-Peer</span>
                                                    <?php endif; ?>
                                                </td>
                                                <td>
                                                    <span class="badge bg-secondary-subtle text-dark badge-ip p-2">
                                                        <?php echo htmlspecialchars($row['ip_loopback']); ?>
                                                    </span>
                                                    <i class="bi bi-clipboard copy-btn ms-1" onclick="copyText('<?php echo $row['ip_loopback']; ?>')" title="คัดลอก Loopback"></i>
                                                </td>
                                                <td>
                                                    <strong><?php echo htmlspecialchars(!empty($row['hostname']) ? $row['hostname'] : '-'); ?></strong>
                                                    <?php if (!empty($row['model'])): ?>
                                                        <div class="text-muted small"><?php echo htmlspecialchars($row['model']); ?></div>
                                                    <?php endif; ?>
                                                </td>
                                                <td>
                                                    <span class="badge bg-light text-dark border">
                                                        <?php echo htmlspecialchars($row['interface']); ?>
                                                    </span>
                                                </td>
                                                <td class="text-break" style="max-width: 320px;">
                                                    <?php echo htmlspecialchars($row['description']); ?>
                                                </td>
                                                <td class="text-muted small"><?php echo htmlspecialchars($row['time']); ?></td>
                                            </tr>
                                        <?php endforeach; ?>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <?php endif; ?>

                    <?php else: ?>
                        <!-- General Mode Single Table -->
                        <div class="table-responsive">
                            <table class="table table-custom table-hover result-table" id="tableGeneralOnly">
                                <thead>
                                    <tr>
                                        <th style="width: 50px;">#</th>
                                        <th style="width: 120px;">ทิศทาง (Path)</th>
                                        <th>IP-WAN</th>
                                        <th>Device (LoopBack 0)</th>
                                        <th>Hostname / Model</th>
                                        <th>Interface</th>
                                        <th>Description</th>
                                        <th>Last Update</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php $idx = 1; foreach ($records as $row): ?>
                                        <tr>
                                            <td class="text-muted small"><?php echo $idx++; ?></td>
                                            <td>
                                                <span class="badge bg-light text-secondary border px-2.5 py-1.5 rounded-pill">
                                                    ทั่วไป (General)
                                                </span>
                                            </td>
                                            <td>
                                                <span class="badge bg-primary-subtle text-primary badge-ip p-2">
                                                    <?php echo htmlspecialchars($row['ip_address']); ?>
                                                </span>
                                                <i class="bi bi-clipboard copy-btn ms-1" onclick="copyText('<?php echo $row['ip_address']; ?>')" title="คัดลอก IP"></i>
                                                <?php if ($row['is_auto_peer']): ?>
                                                    <span class="badge bg-info-subtle text-info rounded-pill ms-1" title="ตรวจหาคู่ใน Subnet อัตโนมัติ">Auto-Peer</span>
                                                <?php endif; ?>
                                            </td>
                                            <td>
                                                <span class="badge bg-secondary-subtle text-dark badge-ip p-2">
                                                    <?php echo htmlspecialchars($row['ip_loopback']); ?>
                                                </span>
                                                <i class="bi bi-clipboard copy-btn ms-1" onclick="copyText('<?php echo $row['ip_loopback']; ?>')" title="คัดลอก Loopback"></i>
                                            </td>
                                            <td>
                                                <strong><?php echo htmlspecialchars(!empty($row['hostname']) ? $row['hostname'] : '-'); ?></strong>
                                                <?php if (!empty($row['model'])): ?>
                                                    <div class="text-muted small"><?php echo htmlspecialchars($row['model']); ?></div>
                                                <?php endif; ?>
                                            </td>
                                            <td>
                                                <span class="badge bg-light text-dark border">
                                                    <?php echo htmlspecialchars($row['interface']); ?>
                                                </span>
                                            </td>
                                            <td class="text-break" style="max-width: 320px;">
                                                <?php echo htmlspecialchars($row['description']); ?>
                                            </td>
                                            <td class="text-muted small"><?php echo htmlspecialchars($row['time']); ?></td>
                                        </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    <?php endif; ?>
                </div>
            </div>

            <!-- Tab 3: Raw Mermaid Code -->
            <div class="tab-pane fade" id="pills-code" role="tabpanel">
                <div class="card border-0 shadow-sm rounded-3 p-3">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="fw-bold text-muted small"><i class="bi bi-file-code me-1"></i> Mermaid Markdown Code</span>
                        <button class="btn btn-outline-primary btn-sm rounded-pill" onclick="copyMermaidCode()">
                            <i class="bi bi-clipboard me-1"></i> Copy All
                        </button>
                    </div>
                    <pre class="code-box mb-0" id="rawMermaidText"><?php echo htmlspecialchars($mermaid_code); ?></pre>
                </div>
            </div>

        </div>

    </div>

    <!-- Modal for New Search -->
    <div class="modal fade" id="searchModal" tabindex="-1" aria-labelledby="searchModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content rounded-4 border-0 shadow">
                <form action="wan2iplo0v2.php" method="POST">
                    <input type="hidden" name="mode" id="modalSelectedMode" value="<?php echo $mode; ?>">
                    <div class="modal-header border-bottom-0 pb-0">
                        <h5 class="modal-title fw-bold" id="searchModalLabel">
                            <i class="bi bi-search text-primary me-2"></i>ระบุรายการ IP-WAN ใหม่
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body py-3">
                        <ul class="nav nav-pills bg-light p-1 rounded-3 border mb-3">
                            <li class="nav-item flex-fill text-center">
                                <button class="nav-link w-100 <?php echo ($mode !== 'asymmetric') ? 'active' : ''; ?>" data-bs-toggle="pill" data-bs-target="#modal-general" type="button" onclick="document.getElementById('modalSelectedMode').value='general'">
                                    โหมดปกติ (General)
                                </button>
                            </li>
                            <li class="nav-item flex-fill text-center">
                                <button class="nav-link w-100 <?php echo ($mode === 'asymmetric') ? 'active' : ''; ?>" data-bs-toggle="pill" data-bs-target="#modal-asym" type="button" onclick="document.getElementById('modalSelectedMode').value='asymmetric'">
                                    โหมดแยกไป-กลับ (Forward / Return)
                                </button>
                            </li>
                        </ul>

                        <div class="tab-content">
                            <div class="tab-pane fade <?php echo ($mode !== 'asymmetric') ? 'show active' : ''; ?>" id="modal-general">
                                <textarea name="ipaddr" rows="7" class="form-control font-monospace mb-2" placeholder="วางรายการ IP-WAN ที่นี่..."><?php echo htmlspecialchars($input_gen); ?></textarea>
                            </div>
                            <div class="tab-pane fade <?php echo ($mode === 'asymmetric') ? 'show active' : ''; ?>" id="modal-asym">
                                <div class="row g-2 mb-2">
                                    <div class="col-6">
                                        <label class="form-label small fw-bold text-primary">🔵 ขาไป (Forward)</label>
                                        <textarea name="ipaddr_fwd" rows="6" class="form-control font-monospace" placeholder="IP ขาไป..."><?php echo htmlspecialchars($input_fwd); ?></textarea>
                                    </div>
                                    <div class="col-6">
                                        <label class="form-label small fw-bold text-warning-emphasis">🟠 ขากลับ (Return)</label>
                                        <textarea name="ipaddr_ret" rows="6" class="form-control font-monospace" placeholder="IP ขากลับ..."><?php echo htmlspecialchars($input_ret); ?></textarea>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="form-check form-switch mt-2">
                            <input class="form-check-input" type="checkbox" role="switch" id="modal_auto_peer" name="auto_peer" value="1" <?php echo ($auto_peer == 1) ? 'checked' : ''; ?>>
                            <label class="form-check-label fw-medium" for="modal_auto_peer">Auto-detect Peer IP in Subnet (/30, /31)</label>
                        </div>
                    </div>
                    <div class="modal-footer border-top-0 pt-0">
                        <button type="button" class="btn btn-light rounded-pill px-4" data-bs-dismiss="modal">ยกเลิก</button>
                        <button type="submit" class="btn btn-primary rounded-pill px-4">ค้นหา</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <!-- Toast Notification -->
    <div class="toast-container position-fixed bottom-0 end-0 p-3">
        <div id="copyToast" class="toast align-items-center text-white bg-dark border-0" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body" id="toastMsg">
                    <i class="bi bi-check-circle-fill text-success me-2"></i> คัดลอกสำเร็จแล้ว
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    </div>

    <!-- Bootstrap JS Bundle -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

    <script>
        // Initialize Mermaid
        mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis'
            }
        });

        document.addEventListener('DOMContentLoaded', function() {
            const rawCode = document.getElementById('rawMermaidText');
            const container = document.getElementById('mermaidGraph');
            if (rawCode && container && rawCode.textContent.trim().length > 0) {
                try {
                    mermaid.render('renderedTopologySvg', rawCode.textContent.trim()).then(function(result) {
                        container.innerHTML = result.svg;
                    }).catch(function(err) {
                        console.error("Mermaid Render Error:", err);
                        container.innerHTML = '<div class="alert alert-danger m-3"><i class="bi bi-exclamation-triangle me-2"></i>ข้อผิดพลาดในการสร้าง Diagram: ' + (err.message || err) + '</div>';
                    });
                } catch (e) {
                    console.error("Mermaid Exception:", e);
                    container.innerHTML = '<div class="alert alert-danger m-3"><i class="bi bi-exclamation-triangle me-2"></i>ข้อผิดพลาด: ' + e.message + '</div>';
                }
            }
        });

        // Copy Helper
        function showToast(msg) {
            const toastEl = document.getElementById('copyToast');
            document.getElementById('toastMsg').innerHTML = `<i class="bi bi-check-circle-fill text-success me-2"></i> ${msg}`;
            const toast = new bootstrap.Toast(toastEl, { delay: 2000 });
            toast.show();
        }

        function copyText(text) {
            navigator.clipboard.writeText(text).then(() => {
                showToast(`คัดลอก: ${text}`);
            });
        }

        function copyMermaidCode() {
            const code = document.getElementById('rawMermaidText').textContent;
            navigator.clipboard.writeText(code).then(() => {
                showToast('คัดลอกโค้ด Mermaid เรียบร้อยแล้ว');
            });
        }

        // Download JPG
        function downloadJPG() {
            const svg = document.querySelector('#mermaidGraph svg');
            if (!svg) {
                alert('ยังไม่มีไดอะแกรมให้ดาวน์โหลด');
                return;
            }

            // Determine dimensions from viewBox or bounding box
            let width = 0;
            let height = 0;
            if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
                width = svg.viewBox.baseVal.width;
                height = svg.viewBox.baseVal.height;
            } else {
                const rect = svg.getBoundingClientRect();
                width = rect.width;
                height = rect.height;
            }

            if (!width || !height) {
                try {
                    const bbox = svg.getBBox();
                    width = bbox.width;
                    height = bbox.height;
                } catch (e) {
                    width = 1200;
                    height = 800;
                }
            }

            // Clone SVG and set explicit dimensions & xmlns
            const clonedSvg = svg.cloneNode(true);
            clonedSvg.setAttribute('width', width);
            clonedSvg.setAttribute('height', height);
            if (!clonedSvg.getAttribute('xmlns')) {
                clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            }

            const svgString = new XMLSerializer().serializeToString(clonedSvg);
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = function() {
                const scale = 2; // Scale 2x for sharp/high-resolution output
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(width * scale);
                canvas.height = Math.round(height * scale);
                const ctx = canvas.getContext('2d');

                // Fill background white because JPEG doesn't support transparency
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);

                try {
                    canvas.toBlob(function(blob) {
                        if (!blob) {
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                            const a = document.createElement('a');
                            a.href = dataUrl;
                            a.download = 'network_topology.jpg';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            return;
                        }
                        const jpgUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = jpgUrl;
                        a.download = 'network_topology.jpg';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(jpgUrl), 2000);
                    }, 'image/jpeg', 0.95);
                } catch (e) {
                    console.error("Canvas export error:", e);
                    alert("เกิดข้อผิดพลาดในการบันทึกภาพ JPG");
                }
            };
            img.onerror = function(err) {
                URL.revokeObjectURL(url);
                console.error("Failed to load SVG for JPG export", err);
                alert("ไม่สามารถแปลงไดอะแกรมเป็นไฟล์ JPG ได้");
            };
            img.src = url;
        }

        // Backward compatibility alias
        const downloadSVG = downloadJPG;

        // Live Table Search Filter
        document.getElementById('tableFilter').addEventListener('keyup', function() {
            const filterValue = this.value.toLowerCase();
            const rows = document.querySelectorAll('.result-table tbody tr');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(filterValue) ? '' : 'none';
            });
        });

        // Export Table to CSV
        function exportTableToCSV(filename) {
            const rows = document.querySelectorAll('.result-table tr');
            let csv = [];
            for (let i = 0; i < rows.length; i++) {
                let row = [], cols = rows[i].querySelectorAll('td, th');
                for (let j = 0; j < cols.length; j++) {
                    let data = cols[j].innerText.replace(/(\r\n|\n|\r)/gm, ' ').replace(/(\s\s+)/gm, ' ');
                    data = data.replace(/"/g, '""');
                    row.push('"' + data + '"');
                }
                csv.push(row.join(','));
            }
            const csvFile = new Blob(["\uFEFF" + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const downloadLink = document.createElement('a');
            downloadLink.download = filename;
            downloadLink.href = window.URL.createObjectURL(csvFile);
            downloadLink.style.display = 'none';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
        }
    </script>
</body>
</html>