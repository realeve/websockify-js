#!/usr/bin/env node

// A WebSocket to TCP socket proxy
// Copyright 2012 Joel Martin
// Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)

// Known to work with node 0.8.9
// Requires node modules: ws and optimist
//     npm install ws optimist

var argv = require("optimist").argv,
  net = require("net"),
  http = require("http"),
  https = require("https"),
  url = require("url"),
  path = require("path"),
  fs = require("fs"),
  Buffer = require("buffer").Buffer,
  WebSocketServer = require("ws").Server,
  webServer,
  wsServer,
  source_host,
  source_port,
  target_host,
  target_port,
  web_path = null;

var lineReader = require("line-reader"),
  target_cfgfile = null;

var now = function () {
  return new Date().toLocaleString();
};

// Handle new WebSocket client
new_client = function (client, req) {
  var target;
  var clientAddr = client._socket.remoteAddress,
    log;
  console.log(req ? req.url : client.upgradeReq.url);
  log = function (msg) {
    console.log(
      " " + clientAddr.replace("::ffff:", "  ") + ": " + msg + "  " + now()
    );
  };
  log("WebSocket connection");
  log(
    "Version " + client.protocolVersion + ", subprotocol: " + client.protocol
  );

  if (argv.targets && target_cfgfile !== null) {
    var requesting = req.url;
    var cfgindex, cfgtoken, hostport, hostportindex;
    idx = requesting.indexOf("=");
    if (idx < 0) {
      throw "target is null";
    }
    var requesttoken = requesting.slice(idx + 1, requesting.length);
    console.log("连接 token :" + requesttoken);
    var isFinded = false;
    lineReader.eachLine(target_cfgfile, function (line, last) {
      // console.log(line);
      cfgindex = line.indexOf(":");
      cfgtoken = line.slice(0, cfgindex);
      if (requesttoken === cfgtoken) {
        isFinded = true;
        console.log("连接 token:" + cfgtoken);
        hostport = line.slice(cfgindex + 1, line.length);
        hostportindex = hostport.indexOf(":");
        target_host = hostport.slice(0, hostportindex);
        target_port = hostport.slice(hostportindex + 1, hostport.length);
        console.log(
          "    - 代理端口 " +
            source_host +
            ":" +
            source_port +
            " 至 " +
            target_host +
            ":" +
            target_port
        );
        target = net.createConnection(target_port, target_host, function () {
          log("连接成功");
        });
        setTarget(target, clientAddr, client);
        return false; // stop reading
      }

      if (last && !isFinded) {
        console.log(requesttoken + "连接失败，请检查配置文件是否设置");
      }
    });
  } else {
    console.log(
      "    - 代理端口 " +
        source_host +
        ":" +
        source_port +
        " 至 " +
        target_host +
        ":" +
        target_port
    );

    target = net.createConnection(target_port, target_host, function () {
      log("连接成功");
    });
    setTarget(target, clientAddr, client);
  }

  client.on("message", function (msg) {
    //log('got message: ' + msg);
    target.write(msg);
  });
  client.on("close", function (code, reason) {
    log("客户端断开连接: " + code + " [" + reason + "]");
    target && target.end();
  });
  client.on("error", function (a) {
    log("WebSocket client error: " + a);
    target && target.end();
  });
};

setTarget = function (target, clientAddr, client) {
  var log = function (msg) {
    console.log(" " + clientAddr + ": " + msg);
  };

  target.on("data", function (data) {
    //log("sending message: " + data);
    try {
      client.send(data);
    } catch (e) {
      log("Client closed, cleaning up target");
      target && target.end();
    }
  });
  target.on("end", function () {
    log("连接断开");
    client.close();
  });
  target.on("error", function () {
    log("target connection error");
    target && target.end();
    client.close();
  });
};

// Send an HTTP error response
http_error = function (response, code, msg) {
  response.writeHead(code, { "Content-Type": "text/plain" });
  response.write(msg + "\n");
  response && response.end();
  return;
};

// Process an HTTP static file request
http_request = function (request, response) {
  //    console.log("pathname: " + url.parse(req.url).pathname);
  //    res.writeHead(200, {'Content-Type': 'text/plain'});
  //    res.end('okay');

  if (!argv.web) {
    return http_error(response, 403, "403 Permission Denied");
  }

  var uri = url.parse(request.url).pathname,
    filename = path.join(argv.web, uri);

  fs.exists(filename, function (exists) {
    if (!exists) {
      return http_error(response, 404, "404 Not Found");
    }

    if (fs.statSync(filename).isDirectory()) {
      filename += "/index.html";
    }

    fs.readFile(filename, "binary", function (err, file) {
      if (err) {
        return http_error(response, 500, err);
      }

      response.writeHead(200);
      response.write(file, "binary");
      response && response.end();
    });
  });
};

// parse source and target arguments into parts
try {
  source_arg = argv._[0].toString();

  var idx;
  idx = source_arg.indexOf(":");
  if (idx >= 0) {
    source_host = source_arg.slice(0, idx);
    source_port = parseInt(source_arg.slice(idx + 1), 10);
  } else {
    source_host = "";
    source_port = parseInt(source_arg, 10);
  }

  if (!argv.targets) {
    target_arg = argv._[1].toString();
    idx = target_arg.indexOf(":");
    if (idx < 0) {
      throw "target must be host:port";
    }
    target_host = target_arg.slice(0, idx);
    target_port = parseInt(target_arg.slice(idx + 1), 10);

    if (isNaN(source_port) || isNaN(target_port)) {
      throw "illegal port";
    }
  }
} catch (e) {
  console.error(
    "websockify.js [--targets target_cfg] [--web web_dir] [--cert cert.pem [--key key.pem]] [source_addr:]source_port target_addr:target_port"
  );
  process.exit(2);
}

console.log("WebSocket settings: ");
if (!argv.targets) {
  console.log(
    "    - proxying from " +
      source_host +
      ":" +
      source_port +
      " to " +
      target_host +
      ":" +
      target_port
  );
}
if (argv.web) {
  console.log("    - Web server active. Serving: " + argv.web);
}

if (argv.targets) {
  target_cfgfile = argv.key || argv.targets;
  console.log("    - target_cfgfile: " + target_cfgfile);
}

if (argv.cert) {
  argv.key = argv.key || argv.cert;
  var cert = fs.readFileSync(argv.cert),
    key = fs.readFileSync(argv.key);
  console.log(
    "    - Running in encrypted HTTPS (wss://) mode using: " +
      argv.cert +
      ", " +
      argv.key
  );
  webServer = https.createServer({ cert: cert, key: key }, http_request);
} else {
  console.log("    - Running in unencrypted HTTP (ws://) mode");
  webServer = http.createServer(http_request);
}
webServer.listen(source_port, function () {
  wsServer = new WebSocketServer({ server: webServer });
  wsServer.on("connection", new_client);
});
