# Most hosts for Java apps can run this file directly. Build with the backend folder as the context.
FROM maven:3.9-amazoncorretto-21 AS build
WORKDIR /app
COPY pom.xml .
COPY src src
RUN mvn -B -q package -DskipTests

FROM amazoncorretto:21-alpine
WORKDIR /app
COPY --from=build /app/target/where-is-my-bus-backend-0.1.0.jar app.jar
# Startup is the slow part on a small free server, so do some of it here, once, at build time:
# unpack the jar, then start the app until it's ready and record the classes it loaded (a class data
# sharing archive). Later starts read that archive instead of loading each class again. The feeds
# aren't downloaded during this run.
RUN java -Djarmode=tools -jar app.jar extract --destination extracted \
 && java -XX:ArchiveClassesAtExit=extracted/app.jsa -Dspring.context.exit=onRefresh -Dwimb.load-feeds=false \
    -jar extracted/app.jar \
 && rm app.jar
# Java also needs memory beyond its heap, about 150 MB. This suits a 512 MB plan, which is the minimum.
ENTRYPOINT ["java", "-XX:SharedArchiveFile=extracted/app.jsa", "-XX:MaxRAMPercentage=65", "-XX:+ExitOnOutOfMemoryError", "-jar", "extracted/app.jar"]
