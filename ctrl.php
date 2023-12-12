<?php
$req = $_SERVER['REQUEST_METHOD'];
$host = "10.0.12.34";
$port = "6722";

if ( $req != "POST" ) {
  exit(http_response_code(403));
}

$n = file_get_contents("php://input");

if ( !preg_match("/\d/", $n) ){
  exit(http_response_code(403));
}

if ( $n > 15 ) {
  exit(http_response_code(403));
}

$n = $n * 60;
$s = $n < 1 ? "2X" : "11:$n";

$fp = @fsockopen($host, $port, $errcode, $errtxt, 1);
fwrite($fp, $s);
fclose($fp);
