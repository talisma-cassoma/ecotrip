import { Inject, Injectable } from '@nestjs/common';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { PrismaService } from '../prisma/prisma.service';
import { DirectionsService } from '../maps/directions/directions.service';
import * as kafkaLib from '@confluentinc/kafka-javascript';

@Injectable()
export class RoutesService {
  constructor(
    private prismaService: PrismaService,
    private directionsService: DirectionsService,
    @Inject('KAFKA_PRODUCER') private kafkaProducer: kafkaLib.KafkaJS.Producer,
  ) {}

  async create(createRouteDto: CreateRouteDto) {
    console.log(createRouteDto);
    const { available_travel_modes, geocoded_waypoints, routes, request } =
      await this.directionsService.getDirections(
        createRouteDto.source_id,
        createRouteDto.destination_id,
      );

    const legs = routes[0].legs[0];
    const route = await this.prismaService.route.create({
      data: {
        name: createRouteDto.name,
        source: {
          name: legs.start_address,
          location: {
            lat: legs.start_location.lat,
            lng: legs.start_location.lng,
          },
        },
        destination: {
          name: legs.end_address,
          location: {
            lat: legs.end_location.lat,
            lng: legs.end_location.lng,
          },
        },
        duration: legs.duration.value,
        distance: legs.distance.value,
        directions: JSON.parse(
          JSON.stringify({
            available_travel_modes,
            geocoded_waypoints,
            routes,
            request,
          }),
        ),
      },
    });

    await this.kafkaProducer.send({
      topic: 'route',
      messages: [
        {
          value: JSON.stringify({
            event: 'RouteCreated',
            id: route.id,
            distance: legs.distance.value,
            directions: legs.steps.reduce((acc, step) => {
              acc.push({
                lat: step.start_location.lat,
                lng: step.start_location.lng,
              });

              acc.push({
                lat: step.end_location.lat,
                lng: step.end_location.lng,
              });
              return acc;
            }, []),
          }),
        },
      ],
    });

    return route;
  }

  async startRoute(id: string) {
    await this.prismaService.route.findUniqueOrThrow({
      where: { id },
    });

    await this.kafkaProducer.send({
      topic: 'route',
      messages: [
        {
          value: JSON.stringify({
            event: 'DeliveryStarted',
            route_id: id,
          }),
        },
      ],
    });
  }

  findAll() {
    return this.prismaService.route.findMany();
  }

 async findOne(id: string) {
  const route = await this.prismaService.route.findUniqueOrThrow({
    where: { id },
  });

  console.log('steps', route.directions);
  
  return {
    ...route,
    directions: typeof route.directions === 'string'
      ? JSON.parse(route.directions)
      : route.directions,
  };
}

  update(id: string, updateRouteDto: UpdateRouteDto) {
    return this.prismaService.route.update({
      where: { id },
      data: updateRouteDto,
    });
  }

  remove(id: number) {
    return `This action removes a #${id} route`;
  }
}
