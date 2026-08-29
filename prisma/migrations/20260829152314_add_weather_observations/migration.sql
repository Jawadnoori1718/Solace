-- CreateTable
CREATE TABLE "WeatherObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "meanTemperatureC" REAL NOT NULL,
    "heatingDegreeHours" REAL NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE UNIQUE INDEX "WeatherObservation_date_key" ON "WeatherObservation"("date");

-- CreateIndex
CREATE INDEX "WeatherObservation_date_idx" ON "WeatherObservation"("date");
