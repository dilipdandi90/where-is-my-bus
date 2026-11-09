# Most hosts for Java apps can run this file directly. Build with the backend folder as the context.
FROM maven:3.9-amazoncorretto-21 AS build
WORKDIR /app
COPY pom.xml .
COPY src src
RUN mvn -B -q package -DskipTests

FROM amazoncorretto:21-alpine
WORKDIR /app
COPY --from=build /app/target/where-is-my-bus-backend-0.1.0.jar app.jar
# Java also needs memory beyond its heap, about 150 MB. This suits a 512 MB plan, which is the minimum.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=65", "-XX:+ExitOnOutOfMemoryError", "-jar", "app.jar"]
