/*-*- coding: utf-8 -*- vim: set ts=4 sw=4 expandtab
##~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
##~ Copyright (C) 2002-2012 Bellite.io                            ##
##~                                                               ##
##~ This library is free software; you can redistribute it        ##
##~ and/or modify it under the terms of the MIT style License as  ##
##~ found in the LICENSE file included with this distribution.    ##
##~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##*/

"use strict";
var net = require('net'),
    util = require('util'),
    events = require('events'),
    deferred = require('fate').deferred;

exports.Bellite = Bellite;
function Bellite(cred) {
    if (!(this instanceof Bellite))
        return new Bellite(cred);

    events.EventEmitter.call(this);
    this._resultMap = {};

    cred = this.findCredentials(cred);
    if (cred == null)
        throw new Error("Invalid Bellite credentials");

    this.on('connect', function(){ this.on_connect(cred) })
    this._connect_jsonrpc(cred);
    return this;
}
util.inherits(Bellite, events.EventEmitter);

Bellite.prototype._connect_jsonrpc = function(cred) {
    var self=this, connBuf='', conn = net.connect(cred);
    conn.setEncoding("UTF-8");
    conn.setNoDelay(true);
    conn.setKeepAlive(true, 0);

    conn.on('connect', function() {
        self.emit('connect') });
    conn.on('data', function(data) {
        data = (connBuf+data).split('\0')
        connBuf = data.pop()
        self._recvJsonRpc(data); });
    self._sendMessage = function sendMessage(msg) {
        return conn.write(msg+'\0') }
    self._shutdown = function() { conn.end(); }
    return conn;
}
Bellite.prototype.findCredentials = function(cred) {
    if (cred === undefined)
        cred = process.env.BELLITE_SERVER || '';
    else if (cred.split === undefined)
        return cred;
    var res={credentials:cred};
    cred = cred.split('/',2);
    if (cred.length<=1)
        return null;
    res.token = cred[1];
    cred = cred[0].split(':',2);
    res.host = cred[0];
    res.port = parseInt(cred[1]);
    return res;
}

Bellite.prototype.logSend = function (msg) {} //console.log('send ==> ', JSON.stringify(msg))}
Bellite.prototype.logRecv = function (msg) {} //console.log('recv <== ', JSON.stringify(msg))}

Bellite.prototype._sendJsonRpc = function sendJsonRpc(method, params, id) {
    var msg = {jsonrpc: "2.0", id:id, method:method, params:params}
    this.logSend(msg);
    return this._sendMessage(JSON.stringify(msg)) }
Bellite.prototype._recvJsonRpc = function recvJsonRpc(msgList) {
    while (msgList.length) {
        var msg = msgList.shift();
        try { msg = JSON.parse(msg) }
        catch (err) { this.on_rpc_error(err, msg); continue }
        this.logRecv(msg);
        if (msg.method!==undefined)
            this.on_rpc_call(msg)
        else this.on_rpc_response(msg)
    } }
Bellite.prototype.on_rpc_error = function(err, msg) {
    console.error("Bellite JSON-RPC error: ", err); }
Bellite.prototype.on_rpc_response = function(msg) {
    var tgt=this._resultMap[msg.id];
    delete this._resultMap[msg.id];
    if (tgt==null) return
    if (msg.error!==undefined)
        tgt.reject(msg.error)
    else tgt.resolve(msg.result) }
Bellite.prototype.on_rpc_call = function(msg) {
    var args=msg.params;
    if (msg.method == 'event')
        this.emit(args.evtType, args) }

Bellite.prototype._nextId = 100;
Bellite.prototype._invoke = function(method, params) {
    var id = this._nextId++,
        res = deferred(this);
    res.method = method;
    this._resultMap[id] = res;
    this._sendJsonRpc(method, params, id);
    return res.promise;}

Bellite.prototype.close = function() {
    return this._shutdown(); }
Bellite.prototype.auth = function(token) {
    return this._invoke('auth', [token]) }
Bellite.prototype.version = function() {
    return this._invoke('version') }
Bellite.prototype.ping = function() {
    return this._invoke('ping') }
Bellite.prototype.respondsTo = function(selfId, cmd) {
    if (!selfId) selfId = 0;
    return this._invoke('respondsTo', [selfId, cmd||""]) }
Bellite.prototype.perform = function(selfId, cmd, args) {
    if (!selfId) selfId = 0;
    return this._invoke('perform', [selfId, cmd||"", args]) }
Bellite.prototype.bindEvent = function(selfId, evtType, res, ctx) {
    if (!selfId) selfId = 0;
    if (evtType===undefined) evtType = null;
    if (res===undefined) res = -1;
    return this._invoke('bindEvent', [selfId, evtType, res, ctx]); }
Bellite.prototype.unbindEvent = function(selfId, evtType) {
    if (!selfId) selfId = 0;
    if (evtType==undefined) evtType = null;
    return this._invoke('unbindEvent', [selfId, evtType]); }

Bellite.prototype.on_connect = function(cred) {
    this.auth(cred.token).then(
        this.on_auth_succeeded, this.on_auth_failed) }
Bellite.prototype.on_auth_succeeded = function(msg) {
    this.emit('auth', true, msg)
    this.emit('ready', msg) }
Bellite.prototype.on_auth_failed = function(msg) {
    this.emit('auth', false, msg) }

