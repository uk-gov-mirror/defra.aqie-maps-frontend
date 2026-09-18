import { createServer } from '../../server.js'
import { statusCodes } from '../../common/constants/status-codes.js'

const {
  mockGetMonitoringStations,
  mockGetMonitoringStationInfo,
  mockGetForecasts,
  mockGetAurnData
} = vi.hoisted(() => ({
  mockGetMonitoringStations: vi.fn(),
  mockGetMonitoringStationInfo: vi.fn(),
  mockGetForecasts: vi.fn(),
  mockGetAurnData: vi.fn()
}))

vi.mock('../../common/helpers/aqie-back-end.js', () => ({
  getMonitoringStations: mockGetMonitoringStations,
  getMonitoringStationInfo: mockGetMonitoringStationInfo,
  getAurnData: mockGetAurnData
}))

vi.mock('../../common/helpers/aqie-forecast-api.js', () => ({
  getForecasts: mockGetForecasts
}))

describe('#apiController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('Should return monitoring stations payload for GET /api/monitoring-stations', async () => {
    const payload = { message: 'success', monitoringStations: [] }
    mockGetMonitoringStations.mockResolvedValue(payload)

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/api/monitoring-stations'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(payload)
  })

  test('Should return monitoring station info payload for GET /api/monitoring-station-info', async () => {
    const payload = { message: 'success', monitoringStationInfo: [] }
    mockGetMonitoringStationInfo.mockResolvedValue(payload)

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/api/monitoring-station-info'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(payload)
  })

  test('Should return forecasts payload for GET /api/forecasts', async () => {
    const payload = { message: 'success', forecasts: [] }
    mockGetForecasts.mockResolvedValue(payload)

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/api/forecasts'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(payload)
  })

  test('Should return 500 when upstream request fails', async () => {
    mockGetMonitoringStations.mockRejectedValue(new Error('upstream failed'))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/api/monitoring-stations'
    })

    expect(statusCode).toBe(statusCodes.internalServerError)
    expect(result).toEqual({
      message: 'Failed to fetch data from upstream API'
    })
  })

  test('Should return 500 for GET /api/monitoring-station-info when upstream request fails', async () => {
    mockGetMonitoringStationInfo.mockRejectedValue(new Error('upstream failed'))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/api/monitoring-station-info'
    })

    expect(statusCode).toBe(statusCodes.internalServerError)
    expect(result).toEqual({
      message: 'Failed to fetch data from upstream API'
    })
  })

  test('Should return AURN measurements payload for GET /api/aurn-data', async () => {
    const payload = {
      message: 'AURN measurements (211 stations)',
      measurements: [
        {
          localSiteID: 'UKA00012',
          daqiIndex: 2,
          measuredAt: '2026-07-29T10:00:00+01:00',
          updatedAt: '2026-07-29T10:36:01.021Z'
        }
      ]
    }
    mockGetAurnData.mockResolvedValue(payload)

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/api/aurn-data'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(payload)
  })

  test('Should return 500 when AURN upstream request fails', async () => {
    mockGetAurnData.mockRejectedValue(new Error('upstream failed'))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/api/aurn-data'
    })

    expect(statusCode).toBe(statusCodes.internalServerError)
    expect(result).toEqual({
      message: 'Failed to fetch AURN data from Aqie Back End'
    })
  })

  test('Should return 500 for GET /api/forecasts when upstream request fails', async () => {
    mockGetForecasts.mockRejectedValue(new Error('upstream failed'))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/api/forecasts'
    })

    expect(statusCode).toBe(statusCodes.internalServerError)
    expect(result).toEqual({
      message: 'Failed to fetch data from upstream API'
    })
  })
})
