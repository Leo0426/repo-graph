#!/bin/sh

##############################################################################
#
#   Gradle start up script for POSIX
#   Delegates to the Gradle wrapper infrastructure
#
##############################################################################

# Resolve APP_HOME
app_path=$0
while [ -h "$app_path" ]; do
    ls=$(ls -ld "$app_path")
    link=${ls#*' -> '}
    case $link in
      /*)   app_path=$link ;;
      *)    app_path=$(dirname "$app_path")/"$link" ;;
    esac
done
APP_HOME=$(cd "$(dirname "$app_path")" && pwd -P)

WRAPPER_JAR="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
WRAPPER_PROPERTIES="$APP_HOME/gradle/wrapper/gradle-wrapper.properties"

# Determine JAVA command
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    JAVACMD="$JAVA_HOME/bin/java"
else
    JAVACMD="java"
fi

# Increase max file descriptors if possible
if ulimit -H -n >/dev/null 2>&1; then
    MAX_FD=$(ulimit -H -n)
    ulimit -n "$MAX_FD" 2>/dev/null
fi

exec "$JAVACMD" \
    -Xmx64m -Xms64m \
    ${JAVA_OPTS-} \
    ${GRADLE_OPTS-} \
    "-Dorg.gradle.appname=$(basename "$0")" \
    -classpath "$WRAPPER_JAR" \
    org.gradle.wrapper.GradleWrapperMain \
    "$@"
