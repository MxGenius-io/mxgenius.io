-keep class com.flir.** { *; }
-dontwarn com.flir.**

# libwebrtc exposes JNI-bound classes by name. Preserve that boundary in the
# minified Alpha build; application-side witness classes remain shrinkable.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
