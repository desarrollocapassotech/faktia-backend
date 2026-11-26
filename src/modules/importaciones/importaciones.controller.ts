import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentAuth, Modulo, type AuthContext } from '../auth';
import { PlantillasMapeoService } from './adapters/excel/plantillas-mapeo.service';
import {
  ActualizarPlantillaMapeoDto,
  EditarItemDto,
  ImportarManualDto,
  ListarItemsQuery,
  PlantillaMapeoDto,
} from './dto/importaciones.dto';
import { ImportacionesService } from './importaciones.service';

const LIMITE_ARCHIVO = { limits: { fileSize: 5 * 1024 * 1024, files: 1 } };

function archivo(a: Express.Multer.File | undefined) {
  if (!a?.buffer?.length) throw new BadRequestException('Falta el archivo.');
  // multer decodifica el nombre como latin1; los navegadores lo mandan en UTF-8.
  return { buffer: a.buffer, nombre: Buffer.from(a.originalname, 'latin1').toString('utf8') };
}

@Modulo('importaciones')
@Controller('importaciones')
export class ImportacionesController {
  constructor(private readonly importaciones: ImportacionesService) {}

  @Get()
  listar(@CurrentAuth() auth: AuthContext, @Query('pagina') pagina?: string) {
    return this.importaciones.listar(auth.tenantId, Math.max(1, Number(pagina) || 1));
  }

  @Get('items')
  items(@CurrentAuth() auth: AuthContext, @Query() q: ListarItemsQuery) {
    return this.importaciones.items(auth.tenantId, q);
  }

  @Get(':id')
  obtener(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.importaciones.obtener(auth.tenantId, id);
  }

  @Post('excel')
  @UseInterceptors(FileInterceptor('archivo', LIMITE_ARCHIVO))
  excel(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() a: Express.Multer.File | undefined,
    @Body('plantillaMapeoId') plantillaMapeoId?: string,
  ) {
    if (!plantillaMapeoId) throw new BadRequestException('Elegí la plantilla de mapeo.');
    return this.importaciones.importarExcel(auth, archivo(a), plantillaMapeoId);
  }

  @Post('manual')
  manual(@CurrentAuth() auth: AuthContext, @Body() dto: ImportarManualDto) {
    return this.importaciones.importarManual(auth, dto.items, dto.descripcion);
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  confirmar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.importaciones.confirmar(auth.tenantId, id);
  }

  @Post(':id/descartar')
  @HttpCode(200)
  descartar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.importaciones.descartar(auth.tenantId, id);
  }

  @Patch('items/:id')
  editarItem(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: EditarItemDto) {
    return this.importaciones.editarItem(auth.tenantId, id, dto);
  }

  @Post('items/:id/descartar')
  @HttpCode(200)
  descartarItem(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.importaciones.descartarItem(auth.tenantId, id);
  }

  @Post('items/:id/restaurar')
  @HttpCode(200)
  restaurarItem(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.importaciones.restaurarItem(auth.tenantId, id);
  }
}

@Modulo('importaciones')
@Controller('configuracion')
export class ConfiguracionImportacionesController {
  constructor(private readonly plantillas: PlantillasMapeoService) {}

  @Get('plantillas-mapeo')
  plantillasMapeo(@CurrentAuth() auth: AuthContext) {
    return this.plantillas.listar(auth.tenantId);
  }

  @Post('plantillas-mapeo')
  crearPlantilla(@CurrentAuth() auth: AuthContext, @Body() dto: PlantillaMapeoDto) {
    return this.plantillas.crear(auth.tenantId, dto);
  }

  @Patch('plantillas-mapeo/:id')
  actualizarPlantilla(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ActualizarPlantillaMapeoDto) {
    return this.plantillas.actualizar(auth.tenantId, id, dto);
  }

  /** Primeras filas del archivo, para armar el mapeo. No guarda nada. */
  @Post('plantillas-mapeo/previsualizar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('archivo', LIMITE_ARCHIVO))
  previsualizar(
    @UploadedFile() a: Express.Multer.File | undefined,
    @Body('hoja') hoja?: string,
    @Body('delimitador') delimitador?: string,
    @Body('encoding') encoding?: string,
  ) {
    const { buffer, nombre } = archivo(a);
    return this.plantillas.previsualizar(buffer, nombre, {
      hoja: hoja || undefined,
      delimitador: delimitador === ',' || delimitador === ';' || delimitador === '\t' ? delimitador : undefined,
      encoding: encoding === 'latin1' ? 'latin1' : undefined,
    });
  }
}
