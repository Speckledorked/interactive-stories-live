-- #175: a location's own descriptive fields (description, locationType,
-- corruption gates, discovery) changing during scene resolution — distinct
-- from the tick-specific LOCATION_WEATHER/LOCATION_CONDITION/LOCATION_POPULATION
-- sub-concerns already in this enum.
ALTER TYPE "WorldEventTargetType" ADD VALUE 'LOCATION';
