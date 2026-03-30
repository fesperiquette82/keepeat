# Keep Expo modules core classes
-keep class expo.modules.kotlin.runtime.** { *; }
-keep class expo.modules.kotlin.services.** { *; }
-keep class expo.modules.kotlin.types.** { *; }

# Keep Expo image manipulator
-keep class expo.modules.imagemanipulator.** { *; }

# Keep Expo notifications
-keep class expo.modules.notifications.** { *; }

# Keep all Expo module classes
-keep class expo.modules.** { *; }

# Preserve line numbers for stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}