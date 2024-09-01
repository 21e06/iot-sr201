<?php

$req = $_SERVER['REQUEST_METHOD'];
$rcp = "152682e172cc503529ec01a7bd6c630115ada57a740966deca1330d04c3c4b83";

if ( $req != "GET" ) {
  exit(http_response_code(403));
}

$bolt11 = filter_input(INPUT_GET, 'bolt11');

if ( substr($bolt11,0,4) !== 'lnbc' ) {
	exit(http_response_code(403));
}

$bolt = "http://ln.bohol.xyz/check-bolt11?bolt11={$bolt11}";
$data = file_get_contents($bolt);
$json = json_decode($data);

if ( $json->status !== 'completed' ) {
	exit(http_response_code(403));
}

if ( hash('sha256', $json->recipient->entityIdentifier) !== $rcp ) {
	exit(http_response_code(403));
}

$time = $json->recipient->total * 60;

$serv = @fsockopen("10.0.12.34",6722, $err, $txt, 1);

if ( !$serv ) {
	exit(http_response_code(408));
}

fwrite($serv, "11:$time");
fclose($serv);

