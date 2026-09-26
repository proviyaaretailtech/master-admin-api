import bcrypt from "bcryptjs";
import { query } from "../config/database.config";
import { BadRequestException, UnauthorizedException } from "../utils/app-error";
import { RegisterInput, LoginInput } from "../validators/auth.validator";
import { signJwtToken } from "../utils/jwt";
import { UserModel } from "../@types/express";

export class AuthService {
  /**
   * Registers a new user with hashed password in Supabase PostgreSQL
   */
  async register(data: RegisterInput) {
    // 1. Check if user already exists
    const checkUser = await query<UserModel>("SELECT id FROM users WHERE email = $1 LIMIT 1;", [
      data.email,
    ]);

    if (checkUser.rows.length > 0) {
      throw new BadRequestException("An account with this email address already exists");
    }

    // 2. Hash password with bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(data.password, saltRounds);

    // 3. Insert into Supabase 'users' table using parameterized query (SQL-injection proof)
    const result = await query<UserModel>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, phone_number, created_at, updated_at;`,
      [data.first_name, data.last_name, data.email, data.phone_number, hashedPassword]
    );

    const newUser = result.rows[0];

    // 4. Generate custom JWT token
    const token = signJwtToken({
      userId: newUser.id,
      email: newUser.email,
    });

    return {
      user: newUser,
      token,
    };
  }

  /**
   * Authenticates user via email and bcrypt password check
   */
  async login(data: LoginInput) {
    // 1. Find user by email
    const result = await query<UserModel>(
      `SELECT id, first_name, last_name, email, phone_number, password, created_at, updated_at
       FROM users
       WHERE email = $1
       LIMIT 1;`,
      [data.email]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const user = result.rows[0];

    // 2. Compare password hash
    const isPasswordValid = await bcrypt.compare(data.password, user.password!);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // 3. Generate custom JWT token
    const token = signJwtToken({
      userId: user.id,
      email: user.email,
    });

    // 4. Strip sensitive password
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword as UserModel,
      token,
    };
  }

  /**
   * Returns authenticated user profile
   */
  async getMe(user: UserModel) {
    return user;
  }
}

export const authService = new AuthService();
