# MxGenius Sensor Bridge 0.1.0-poc.7

- Keeps the FLIR foreground service alive while transferring foreground ownership back to Meta Browser.
- Automatically requests FLIR discovery/USB permission for browser-initiated local sessions.
- Relaunches the isolated sensor scene only after the first decoded FLIR frame.
- Passes the local session through a URL fragment that the browser immediately consumes and removes.
- Adds **PIN HERE / FOLLOW HEAD** control for world-space thermal placement in WebXR.
- Retains the standalone native thermal preview and manual retry path.
