// @flow
import lonlat from '@conveyal/lonlat'
import filter from 'lodash/filter'
import get from 'lodash/get'
import orderBy from 'lodash/orderBy'
import {createSelector} from 'reselect'

import selectNeighborhoodRoutes from './network-neighborhood-routes'
import neighborhoodTravelTimes from './neighborhood-travel-times'

// ~130km estimate of maximum straight-line distance drivable in area within 120 minutes
const MAX_DISTANCE = 130000
const MAX_TRAVEL_TIME = 120
const RENT_DIFF_RANGE = 2000

// Sorting weights. Must sum to one.
const TIME_SORT_WEIGHT = 0.6
const RENT_SORT_WEIGHT = 0.4

export default createSelector(
  selectNeighborhoodRoutes,
  neighborhoodTravelTimes,
  state => get(state, 'data.neighborhoods'),
  state => get(state, 'data.origin'),
  state => get(state, 'data.userProfile'),
  (neighborhoodRoutes, travelTimes, neighborhoods, origin, profile) => {
    if (!neighborhoods || !neighborhoods.features || !neighborhoods.features.length ||
      !neighborhoodRoutes || !neighborhoodRoutes.length) {
      return []
    }
    const useTransit = !profile || !profile.hasVehicle
    const neighborhoodsWithRoutes = filter(neighborhoods.features.map((n, index) => {
      const route = neighborhoodRoutes[index]
      const active = route.active
      const segments = useTransit ? route.routeSegments : []
      const time = useTransit ? travelTimes[index] : distanceTime(origin, n)

      // Map weighting values to percentages

      // Routable neighborhoods outside the max travel time window will be filtered out.
      // Smaller travel time is better; larger timeWeight is better (reverse range).
      const timeWeight = time < MAX_TRAVEL_TIME ? scale(time, 0, MAX_TRAVEL_TIME, 1, 0) : 1

      // Normalize rent differential to fair market value to a range;
      // any value outside the range will be given the min/max value for the range.
      var useRentDiff = n.properties.rent_diff
      if (useRentDiff > RENT_DIFF_RANGE) {
        useRentDiff = RENT_DIFF_RANGE
      } else if (useRentDiff < -RENT_DIFF_RANGE) {
        useRentDiff = -RENT_DIFF_RANGE
      }

      // Smaller fair-market rent differential is better;
      // larger rentWeight is better (reverse range).
      const rentWeight = scale(useRentDiff, -RENT_DIFF_RANGE, RENT_DIFF_RANGE, 1, 0)

      // Calculate weighted score from the percentages. Larger score is better.
      const score = (timeWeight * TIME_SORT_WEIGHT) + (rentWeight * RENT_SORT_WEIGHT)

      return Object.assign({active, rentWeight, score, segments, time, timeWeight}, n)
    }), n => !useTransit || (n.segments && n.segments.length && n.time < MAX_TRAVEL_TIME))

    return orderBy(neighborhoodsWithRoutes, ['score'], ['desc'])
  }
)

// Estimate drive time, using straight-line distance
const distanceTime = (origin, neighborhood) => {
  // First get distance in meters between origin and a neighborhood point
  const destination = lonlat.toLeaflet(neighborhood.geometry.coordinates)
  const distance = destination.distanceTo(origin.position)
  const normalized = distance < MAX_DISTANCE ? distance : MAX_DISTANCE
  // Then map the distance to the travel time range
  return scale(normalized, 0, MAX_DISTANCE, 0, MAX_TRAVEL_TIME)
}

// Map value from one range to another
const scale = (num, startMin, startMax, rangeMin, rangeMax) => {
  return (num - startMin) * (rangeMax - rangeMin) / (startMax - startMin) + rangeMin
}