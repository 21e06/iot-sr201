<?php
$req = $_SERVER['REQUEST_METHOD'];
$tok = $_SERVER['HTTP_TOKEN'];
$host = "10.0.12.34";
$port = "6722";
$token = "e0544a80a086d6c1e61766a4a451bbeeb53a03bac201f4c9fff9c9c9cc694b30";

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
$t = 0;

if ( $n === 't' ) {
	$n = 10; $t = 1;
}

if ( !preg_match("/\d/", $n) ){
  exit(http_response_code(403));
}

if ( $n > 20 ) {
  exit(http_response_code(403));
}

$n = $t > 0 ? $n : $n * 60;
$s = $n < 1 ? "2X" : "11:$n";

$fp = @fsockopen($host, $port, $errcode, $errtxt, 3);

if ( !$fp ) {
	http_response_code(408);
	exit;
}

fwrite($fp, $s);

//echo fread($fp,8);

fclose($fp);
