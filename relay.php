<?php
$req = $_SERVER['REQUEST_METHOD'];
$tok = $_SERVER['HTTP_TOKEN'];
$host = "10.0.12.34";
$port = "6722";
$token = "4e6eb420369156d6d3c30a0a1f52f418cd8c99f294dfe2a350a161a714af9693";

if ( !isset($tok) ) {
	exit(http_response_code(403));
}

if ( hash('sha256', $tok) !== $token ) {
	exit(http_response_code(401));
}

if ( $req != "POST" ) {
  exit(http_response_code(403));
}

$n = file_get_contents("php://input");

if ( !preg_match("/\d/", $n) ){
  exit(http_response_code(403));
}

if ( $n > 20 ) {
  exit(http_response_code(403));
}

$n = $n * 60;
$s = $n < 1 ? "2X" : "11:$n";

$fp = @fsockopen($host, $port, $errcode, $errtxt, 10);

if ( !$fp ) {
	http_response_code(408);
	exit;
}

fwrite($fp, $s);

//echo fread($fp,8);

fclose($fp);
