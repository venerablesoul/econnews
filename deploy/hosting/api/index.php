<?php

define('UPSTREAM', rtrim(getenv('ECONNEWS_UPSTREAM') ?: 'https://econnews-bot.econnews-6dce35.workers.dev', '/'));
const TIMEOUT = 25;

function out($status, $type, $body, $extra = []) {
    http_response_code($status);
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: X-Tg-Init, X-Owner-Key, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Max-Age: 86400');
    header('X-Relay: econnews');
    if ($type) header('Content-Type: ' . $type);
    foreach ($extra as $h) header($h);
    echo $body;
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') out(204, null, '');
if ($method !== 'GET' && $method !== 'POST') out(405, 'application/json', '{"ok":false,"error":"method"}');

$uri = $_SERVER['REQUEST_URI'] ?? '/';
$uri = preg_replace('#^/api/index\.php#', '/api', $uri);
$path = explode('?', $uri, 2)[0];
if (!preg_match('#^/api/[A-Za-z0-9_\-/.,%&:]*$#', $path) || strpos($path, '..') !== false) {
    out(404, 'application/json', '{"ok":false,"error":"not found"}');
}

$headers = ['Accept: application/json', 'User-Agent: econnews-relay/1'];
foreach (['HTTP_X_TG_INIT' => 'X-Tg-Init', 'HTTP_X_OWNER_KEY' => 'X-Owner-Key', 'CONTENT_TYPE' => 'Content-Type'] as $k => $name) {
    if (!empty($_SERVER[$k])) $headers[] = $name . ': ' . str_replace(["\r", "\n"], '', $_SERVER[$k]);
}
$body = $method === 'POST' ? file_get_contents('php://input', false, null, 0, 200000) : null;

if (function_exists('curl_init')) {
    $ch = curl_init(UPSTREAM . $uri);
    $respHeaders = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => TIMEOUT,
        CURLOPT_ENCODING => '',
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$respHeaders) {
            $p = strpos($line, ':');
            if ($p) $respHeaders[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
            return strlen($line);
        },
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $res = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($res === false || !$status) out(502, 'application/json', json_encode(['ok' => false, 'error' => 'relay: ' . $err]));
    $type = $respHeaders['content-type'] ?? 'application/json';
    $cache = isset($respHeaders['cache-control']) ? ['Cache-Control: ' . $respHeaders['cache-control']] : ['Cache-Control: no-store'];
    out($status, $type, $res, $cache);
}

$ctx = stream_context_create(['http' => [
    'method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '',
    'timeout' => TIMEOUT, 'ignore_errors' => true, 'follow_location' => 0,
]]);
$res = @file_get_contents(UPSTREAM . $uri, false, $ctx);
if ($res === false) out(502, 'application/json', '{"ok":false,"error":"relay: upstream unreachable"}');
$status = 200; $type = 'application/json'; $cache = 'no-store';
foreach ($http_response_header ?? [] as $h) {
    if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $status = (int) $m[1];
    elseif (stripos($h, 'content-type:') === 0) $type = trim(substr($h, 13));
    elseif (stripos($h, 'cache-control:') === 0) $cache = trim(substr($h, 14));
}
out($status, $type, $res, ['Cache-Control: ' . $cache]);
