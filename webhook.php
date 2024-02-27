<?php

$req = $_SERVER['REQUEST_METHOD'];

if ( $req != "POST" ) {
  exit(http_response_code(403));
}

$d = file_get_contents("php://input");
$d = json_decode($d);

if ( !$d ) {
  exit(http_response_code(403));
}

$n = $d->amount / 1000; // 1 sat per second

$c = @fsockopen("10.0.12.34",6722,$err,$txt,1);
fwrite($c, "11:$n");
fclose($c);

