<?php
$req = $_SERVER['REQUEST_METHOD'];

if ( $req != "POST" ) {
  exit(http_response_code(403));
}

$n = file_get_contents("php://input");

if ( $n == 0 ) {
  $fp = @fsockopen("10.0.12.34", 6722, $errcode, $errmsg, 1);

  fwrite($fp,"2X");
  fclose($fp);

  exit;
}

file_put_contents('/tmp/time.bomb', $n);
