package com.gametool.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;

@CapacitorPlugin(name = "GdpiHost")
public class GdpiHostPlugin extends Plugin {
    private WebSocketServer server;
    private DatagramSocket udp;
    private DatagramSocket udpData;
    private DatagramSocket udpClient;
    private InetSocketAddress udpTarget;
    private volatile boolean udpRunning = false;
    private volatile boolean udpDataRunning = false;
    private String roomCode = "";
    private String roomName = "";
    private int hostPort = 3210;
    private byte fragIdCounter = 0;
    private final java.util.Map<String, FragBuf> hostFragBufs = new java.util.HashMap<>();
    private final java.util.Map<Byte, FragBuf> clientFragBufs = new java.util.HashMap<>();
    private final java.util.Map<String, Byte> hostLastFrag = new java.util.HashMap<>();
    private final java.util.Map<String, Long> hostLastFragAt = new java.util.HashMap<>();
    private final java.util.Map<Byte, Long> clientLastFragAt = new java.util.HashMap<>();

    static class FragBuf {
        int total;
        java.util.Map<Integer, byte[]> parts = new java.util.HashMap<>();
    }

    private void sendFragmented(DatagramSocket sock, InetSocketAddress target, byte[] data) {
        int max = 1200;
        byte fragId = ++fragIdCounter;
        int total = (int) Math.ceil(data.length / (double) max);
        if (total == 0) total = 1;
        for (int i = 0; i < total; i++) {
            int len = Math.min(max, data.length - i * max);
            byte[] pkt = new byte[4 + len];
            pkt[0] = (byte) 0x46;
            pkt[1] = fragId;
            pkt[2] = (byte) i;
            pkt[3] = (byte) total;
            System.arraycopy(data, i * max, pkt, 4, len);
            try {
                sock.send(new DatagramPacket(pkt, pkt.length, target));
                Thread.sleep(3);
                sock.send(new DatagramPacket(pkt, pkt.length, target));
                Thread.sleep(3);
                sock.send(new DatagramPacket(pkt, pkt.length, target));
            } catch (Exception ignored) {
            }
        }
    }

    @PluginMethod
    public void setRoomInfo(PluginCall call) {
        roomCode = call.getString("code", "");
        roomName = call.getString("name", "");
        call.resolve();
    }

    @PluginMethod
    public void setRoomCode(PluginCall call) {
        roomCode = call.getString("code", "");
        call.resolve();
    }

    private void startUdp() {
        if (udpRunning) return;
        try {
            udp = new DatagramSocket(3001);
            udp.setSoTimeout(500);
            try {
                udp.setReceiveBufferSize(1024 * 1024);
            } catch (Exception ignored) {
            }
            udpRunning = true;
            final DatagramSocket s = udp;
            new Thread(() -> {
                byte[] buf = new byte[65507];
                while (udpRunning) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                        s.receive(pkt);
                        byte[] data = pkt.getData();
                        int len = pkt.getLength();
                        if (len == 8 && new String(data, 0, 8, "UTF-8").equals("DISCOVER")) {
                            for (String ip : getLanIPs()) {
                                byte[] reply = ("GDPMONO:" + ip + ":" + hostPort + ":" + roomCode + ":" + roomName).getBytes("UTF-8");
                                s.send(new DatagramPacket(reply, reply.length, pkt.getAddress(), pkt.getPort()));
                            }
                            continue;
                        }
                        if (len >= 4 && data[0] == (byte) 0x46) {
                            byte fragId = data[1];
                            byte idx = data[2];
                            int total = data[3] & 0xFF;
                            String key = pkt.getAddress().getHostAddress() + ":" + pkt.getPort();
                            FragBuf fb = hostFragBufs.get(key);
                            if (fb == null || fb.total != total) {
                                fb = new FragBuf();
                                fb.total = total;
                                hostFragBufs.put(key, fb);
                            }
                            byte[] payload = new byte[len - 4];
                            System.arraycopy(data, 4, payload, 0, len - 4);
                            fb.parts.put((int) idx, payload);
                            if (fb.parts.size() >= fb.total) {
                                hostFragBufs.remove(key);
                                long nowT = System.currentTimeMillis();
                                Byte prevFrag = hostLastFrag.get(key);
                                Long prevAt = hostLastFragAt.get(key);
                                if (prevFrag != null && prevFrag == fragId && prevAt != null && nowT - prevAt < 3000) {
                                    continue;
                                }
                                hostLastFrag.put(key, fragId);
                                hostLastFragAt.put(key, nowT);
                                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                                for (int i = 0; i < fb.total; i++) {
                                    byte[] part = fb.parts.get(i);
                                    if (part == null) break;
                                    bos.write(part, 0, part.length);
                                }
                                if (bos.size() > 0) {
                                    String msg = new String(bos.toByteArray(), "UTF-8");
                                    JSObject ret = new JSObject();
                                    ret.put("type", "message");
                                    ret.put("connId", "udp:" + key);
                                    ret.put("msg", msg);
                                    notifyListeners("gdpiHostEvent", ret);
                                }
                            }
                        }
                    } catch (Exception ignored) {
                    }
                }
            }).start();
        } catch (Exception ignored) {
        }
    }

    private void stopUdp() {
        udpRunning = false;
        udpDataRunning = false;
        if (udp != null) {
            try {
                udp.close();
            } catch (Exception ignored) {
            }
            udp = null;
        }
        if (udpData != null) {
            try {
                udpData.close();
            } catch (Exception ignored) {
            }
            udpData = null;
        }
    }

    @PluginMethod
    public void udpSendTo(PluginCall call) {
        String connId = call.getString("connId", "");
        String msg = call.getString("msg", "");
        getBridge().execute(() -> {
            if (udp == null || !udpRunning) {
                call.reject("主机未启动");
                return;
            }
            try {
                String key = connId.startsWith("udp:") ? connId.substring(4) : connId;
                String[] parts = key.split(":");
                InetSocketAddress target = new InetSocketAddress(parts[0], Integer.parseInt(parts[1]));
                sendFragmented(udp, target, msg.getBytes("UTF-8"));
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "发送失败" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void udpConnect(PluginCall call) {
        String ip = call.getString("ip", "");
        int port = call.getInt("port", 3001);
        getBridge().execute(() -> {
            try {
                if (udpClient != null) {
                    try {
                        udpClient.close();
                    } catch (Exception ignored) {
                    }
                }
                udpClient = new DatagramSocket();
                udpClient.setSoTimeout(500);
                try {
                    udpClient.setReceiveBufferSize(1024 * 1024);
                } catch (Exception ignored) {
                }
                udpTarget = new InetSocketAddress(ip, port);
                final DatagramSocket sc = udpClient;
                new Thread(() -> {
                    byte[] buf = new byte[65507];
                    while (sc != null && !sc.isClosed()) {
                        try {
                            DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                            sc.receive(pkt);
                            byte[] data = pkt.getData();
                            int len = pkt.getLength();
                            if (len >= 4 && data[0] == (byte) 0x46) {
                                byte fragId = data[1];
                                byte idx = data[2];
                                int total = data[3] & 0xFF;
                                FragBuf fb = clientFragBufs.get(fragId);
                                if (fb == null || fb.total != total) {
                                    fb = new FragBuf();
                                    fb.total = total;
                                    clientFragBufs.put(fragId, fb);
                                }
                                byte[] payload = new byte[len - 4];
                                System.arraycopy(data, 4, payload, 0, len - 4);
                                fb.parts.put((int) idx, payload);
                                if (fb.parts.size() >= fb.total) {
                                    clientFragBufs.remove(fragId);
                                    long nowT = System.currentTimeMillis();
                                    Long prevAt = clientLastFragAt.get(fragId);
                                    if (prevAt != null && nowT - prevAt < 3000) {
                                        continue;
                                    }
                                    clientLastFragAt.put(fragId, nowT);
                                    java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                                    for (int i = 0; i < fb.total; i++) {
                                        byte[] part = fb.parts.get(i);
                                        if (part == null) break;
                                        bos.write(part, 0, part.length);
                                    }
                                    if (bos.size() > 0) {
                                        JSObject ret = new JSObject();
                                        ret.put("msg", new String(bos.toByteArray(), "UTF-8"));
                                        notifyListeners("gdpiUdpEvent", ret);
                                    }
                                }
                            }
                        } catch (Exception ignored) {
                        }
                    }
                }).start();
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "UDP连接失败" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void udpSend(PluginCall call) {
        String msg = call.getString("msg", "");
        getBridge().execute(() -> {
            if (udpClient == null || udpTarget == null) {
                call.reject("UDP未连接");
                return;
            }
            try {
                sendFragmented(udpClient, udpTarget, msg.getBytes("UTF-8"));
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "发送失败" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void udpClose(PluginCall call) {
        getBridge().execute(() -> {
            if (udpClient != null) {
                try {
                    udpClient.close();
                } catch (Exception ignored) {
                }
                udpClient = null;
            }
            udpTarget = null;
            call.resolve();
        });
    }

    @PluginMethod
    public void discoverRooms(PluginCall call) {
        getBridge().execute(() -> {
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                socket.setSoTimeout(400);
                socket.setBroadcast(true);
                byte[] buf = "DISCOVER".getBytes("UTF-8");
                InetAddress bcast = InetAddress.getByName("255.255.255.255");
                socket.send(new DatagramPacket(buf, buf.length, bcast, 3001));
                byte[] recv = new byte[256];
                long deadline = System.currentTimeMillis() + 2500;
                java.util.Map<String, JSObject> found = new java.util.LinkedHashMap<>();
                while (System.currentTimeMillis() < deadline) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(recv, recv.length);
                        socket.receive(pkt);
                        String reply = new String(pkt.getData(), 0, pkt.getLength(), "UTF-8").trim();
                        String[] parts = reply.split(":", 5);
                        if (parts.length >= 4 && "GDPMONO".equals(parts[0])) {
                            String key = parts[1] + ":" + parts[2];
                            if (!found.containsKey(key)) {
                                JSObject item = new JSObject();
                                item.put("ip", parts[1]);
                                item.put("port", Integer.parseInt(parts[2]));
                                item.put("code", parts[3]);
                                item.put("name", parts.length >= 5 ? parts[4] : "");
                                found.put(key, item);
                            }
                        }
                    } catch (Exception e) {
                        if (System.currentTimeMillis() >= deadline) break;
                    }
                }
                com.getcapacitor.JSArray arr = new com.getcapacitor.JSArray();
                for (JSObject item : found.values()) {
                    arr.put(item);
                }
                JSObject ret = new JSObject();
                ret.put("rooms", arr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "发现失败" : e.getMessage());
            } finally {
                if (socket != null) socket.close();
            }
        });
    }

    @PluginMethod
    public void discoverRoom(PluginCall call) {
        String code = call.getString("code", "").trim().toUpperCase();
        getBridge().execute(() -> {
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                socket.setSoTimeout(400);
                socket.setBroadcast(true);
                byte[] buf = "DISCOVER".getBytes("UTF-8");
                InetAddress bcast = InetAddress.getByName("255.255.255.255");
                socket.send(new DatagramPacket(buf, buf.length, bcast, 3001));
                byte[] recv = new byte[128];
                long deadline = System.currentTimeMillis() + 3000;
                while (System.currentTimeMillis() < deadline) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(recv, recv.length);
                        socket.receive(pkt);
                        String reply = new String(pkt.getData(), 0, pkt.getLength(), "UTF-8").trim();
                        String[] parts = reply.split(":");
                        if (parts.length >= 4 && "GDPMONO".equals(parts[0])) {
                            String code2 = parts[3].trim().toUpperCase();
                            if (code2.equals(code) || code.isEmpty()) {
                                JSObject ret = new JSObject();
                                ret.put("ip", parts[1]);
                                ret.put("port", Integer.parseInt(parts[2]));
                                ret.put("code", parts[3]);
                                call.resolve(ret);
                                return;
                            }
                        }
                    } catch (Exception e) {
                        if (System.currentTimeMillis() >= deadline) break;
                    }
                }
                call.reject("未找到该房间，请确认房主已创建房间且同一WiFi");
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "发现失败" : e.getMessage());
            } finally {
                if (socket != null) socket.close();
            }
        });
    }

    @PluginMethod
    public void startHost(PluginCall call) {
        int port = call.getInt("port", 3210);
        hostPort = port;
        getBridge().execute(() -> {
            if (server != null) {
                try {
                    server.stop(200);
                } catch (Exception ignored) {
                }
                server = null;
            }
            try {
                server = new WebSocketServer(new InetSocketAddress(port)) {
                    @Override
                    public void onOpen(WebSocket conn, ClientHandshake handshake) {
                        conn.setAttachment(conn.hashCode());
                        JSObject ret = new JSObject();
                        ret.put("type", "open");
                        ret.put("connId", String.valueOf(conn.hashCode()));
                        try {
                            ret.put("ip", String.valueOf(conn.getRemoteSocketAddress()));
                        } catch (Exception ignored) {
                        }
                        notifyListeners("gdpiHostEvent", ret);
                    }

                    @Override
                    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
                        JSObject ret = new JSObject();
                        ret.put("type", "close");
                        ret.put("connId", String.valueOf(conn.getAttachment()));
                        notifyListeners("gdpiHostEvent", ret);
                    }

                    @Override
                    public void onMessage(WebSocket conn, String message) {
                        JSObject ret = new JSObject();
                        ret.put("type", "message");
                        ret.put("connId", String.valueOf(conn.getAttachment()));
                        ret.put("msg", message);
                        notifyListeners("gdpiHostEvent", ret);
                    }

                    @Override
                    public void onError(WebSocket conn, Exception ex) {
                    }

                    @Override
                    public void onStart() {
                    }
                };
                server.start();
                startUdp();
                JSObject ret = new JSObject();
                ret.put("ip", getLanIP());
                ret.put("port", port);
                com.getcapacitor.JSArray ips = new com.getcapacitor.JSArray();
                for (String ip : getLanIPs()) {
                    ips.put(ip);
                }
                ret.put("ips", ips);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "启动失败" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void sendMsg(PluginCall call) {
        String connId = call.getString("connId");
        String msg = call.getString("msg", "");
        getBridge().execute(() -> {
            if (server == null) {
                call.reject("主机未启动");
                return;
            }
            try {
                if (connId == null || connId.length() == 0) {
                    server.broadcast(msg);
                } else {
                    for (WebSocket conn : server.getConnections()) {
                        if (String.valueOf(conn.getAttachment()).equals(connId)) {
                            conn.send(msg);
                            break;
                        }
                    }
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "发送失败" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopHost(PluginCall call) {
        getBridge().execute(() -> {
            if (server != null) {
                try {
                    server.stop(200);
                } catch (Exception ignored) {
                }
                server = null;
            }
            stopUdp();
            call.resolve();
        });
    }

    public static String getLanIP() {
        java.util.List<String> ips = getLanIPs();
        return ips.isEmpty() ? "127.0.0.1" : ips.get(0);
    }

    public static java.util.List<String> getLanIPs() {
        java.util.List<String> result = new java.util.ArrayList<>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                String niName = ni.getName().toLowerCase();
                int priority = 3;
                if (niName.contains("uu") || niName.contains("tun") || niName.contains("tap") || niName.contains("wintun") || niName.contains("zerotier")) priority = 1;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) {
                        String ip = a.getHostAddress();
                        if (ip.startsWith("10.") || ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") || ip.startsWith("172.19.") || ip.startsWith("172.2") || ip.startsWith("172.30.") || ip.startsWith("172.31.")) {
                            if (priority > 1) priority = 1;
                        } else if (ip.startsWith("192.168.")) {
                            if (priority > 2) priority = 2;
                        }
                        result.add(priority + "|" + ip);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        java.util.Collections.sort(result);
        java.util.List<String> ips = new java.util.ArrayList<>();
        for (String s : result) {
            ips.add(s.substring(s.indexOf('|') + 1));
        }
        return ips;
    }
}
