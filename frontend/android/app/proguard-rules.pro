# Keep Expo modules core classes
-keep class expo.modules.kotlin.runtime.** { *; }
-keep class expo.modules.kotlin.runtime.Runtime { *; }
-keep class expo.modules.kotlin.services.** { *; }
-keep class expo.modules.kotlin.services.FilePermissionService { *; }
-keep class expo.modules.kotlin.services.FilePermissionService$Permission { *; }
-keep class expo.modules.kotlin.types.** { *; }
-keep class expo.modules.kotlin.types.JSTypeConverterProvider { *; }

# Keep Expo filesystem
-keep class expo.modules.filesystem.** { *; }
-keep class expo.modules.filesystem.FileSystemFile { *; }
-keep class expo.modules.filesystem.FileSystemPath { *; }
-keep class expo.modules.filesystem.FileSystemFileHandle { *; }
-keep class expo.modules.filesystem.FileSystemModule { *; }

# Keep Expo image manipulator
-keep class expo.modules.imagemanipulator.** { *; }
-keep class expo.modules.imagemanipulator.ImageManipulatorContext { *; }

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

# R8 may not find Expo runtime classes during minification if using dynamic class loading
# Allow R8 to continue build by warning instead of failing on these missing references
-dontwarn expo.modules.kotlin.runtime.**
-dontwarn expo.modules.kotlin.services.**
-dontwarn expo.modules.filesystem.**
-dontwarn expo.modules.imagemanipulator.**
-dontwarn expo.modules.notifications.**